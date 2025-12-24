const express = require("express");
const http = require("http");
const path = require("path");
const session = require("express-session");
const { Pool } = require("pg");
const pgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcryptjs");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");

const app = express();
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

/* ---------------- APP CONFIG ---------------- */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ---------------- DATABASE ---------------- */
const pool = new Pool({
  user: "firstdemo_examle_user",
  host: "dpg-d50evbfgi27c73aje1pg-a.oregon-postgres.render.com",
  database: "firstdemo_examle",
  password: "6LBDu09slQHqq3r0GcwbY1nPera4H5Kk",
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

pool.query("SELECT NOW()", (err) => {
  if(err) console.error("DB Error:", err);
  else console.log("✅ Database connected");
});

/* ---------------- SESSION ---------------- */
app.use(
  session({
    store: new pgSession({ pool, tableName: "session" }),
    secret: process.env.SESSION_SECRET || "dev_secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 1000*60*60*24 }
  })
);

/* ---------------- EMAIL ---------------- */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "la4400512@gmail.com",
    pass: "zsfs dvwg peso xokp" // Use Google App Password
  }
});

/* ---------------- SOCKET.IO ---------------- */
let mdSockets = [];
io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.on("registerMD", userId => {
    mdSockets.push({ userId, socketId: socket.id });
  });

  socket.on("disconnect", () => {
    mdSockets = mdSockets.filter(s => s.socketId !== socket.id);
  });
});

/* ---------------- MIDDLEWARE ---------------- */
function isLoggedIn(req,res,next){
  if(!req.session.user) return res.redirect("/");
  next();
}

function isMD(req,res,next){
  if(req.session.user.role !== "MD") return res.send("❌ Access denied");
  next();
}

/* ---------------- ROUTES ---------------- */

/* LOGIN */
app.get("/", (req,res)=> res.render("login",{ error: null }));

app.post("/login", async (req,res)=>{
  const { email,password } = req.body;
  try{
    const result = await pool.query("SELECT * FROM users WHERE email=$1",[email]);
    if(result.rowCount===0) return res.render("login",{ error: "User not found" });

    const user = result.rows[0];
    const match = await bcrypt.compare(password,user.password);
    if(!match) return res.render("login",{ error:"Wrong password" });

    req.session.user = { id:user.id, username:user.username, role:user.role };
    res.redirect("/procurement");
  }catch(err){
    console.error(err);
    res.render("login",{ error:"Server error" });
  }
});

/* DASHBOARD */
app.get("/procurement", isLoggedIn, (req,res)=>{
  res.render("procurement",{ username:req.session.user.username, role:req.session.user.role });
});

/* ASSIGN (MD only) */
app.get("/assign", isLoggedIn, isMD, async (req,res)=>{
  const result = await pool.query("SELECT id, username FROM users ORDER BY username");
  res.render("assign",{ employees: result.rows });
});

app.post("/assign", isLoggedIn, isMD, async (req,res)=>{
  const { "assign-to": empId, budget, "project-name": name, "project-code": code, "additional-note": note } = req.body;
  try{
    await pool.query(
      `INSERT INTO assignments(employee_id, budget, project_name, project_code, note, status)
       VALUES($1,$2,$3,$4,$5,'Pending')`,
       [empId,budget,name,code,note]
    );

    const emp = await pool.query("SELECT email, username FROM users WHERE id=$1",[empId]);

    // send email
    await transporter.sendMail({
      to: emp.rows[0].email,
      subject: "Project Assigned",
      html: `<p>Hello ${emp.rows[0].username}, Project <b>${name}</b> has been assigned to you.</p>`
    });

    res.json({ success:true, message:"Assigned & Email Sent" });
  }catch(err){
    console.error("Assign Error:", err);
    res.status(500).json({ success:false, message:"Server error" });
  }
});

/* REPORT */
app.get("/report", isLoggedIn, async (req,res)=>{
  try{
    let result;
    if(req.session.user.role==="MD"){
      result = await pool.query(
        `SELECT a.id, u.username AS employee, a.project_name, a.project_code, a.budget, a.note, a.status, a.created_at
         FROM assignments a
         JOIN users u ON a.employee_id = u.id
         ORDER BY a.created_at DESC`
      );
    }else{
      result = await pool.query(
        `SELECT a.id, u.username AS employee, a.project_name, a.project_code, a.budget, a.note, a.status, a.created_at
         FROM assignments a
         JOIN users u ON a.employee_id = u.id
         WHERE a.employee_id=$1
         ORDER BY a.created_at DESC`,[req.session.user.id]
      );
    }
    res.render("report",{ username:req.session.user.username, role:req.session.user.role, userId:req.session.user.id, assignments: result.rows });
  }catch(err){
    console.error(err);
    res.send("Error fetching assignments");
  }
});

/* UPDATE STATUS (Employee Accept/Hold/Reject) */
app.post("/update-status", isLoggedIn, async (req,res)=>{
  const { assignmentId, status } = req.body;
  const employeeId = req.session.user.id;

  try{
    const result = await pool.query(
      "UPDATE assignments SET status=$1 WHERE id=$2 AND employee_id=$3 RETURNING *",
      [status, assignmentId, employeeId]
    );

    if(result.rowCount===0) return res.status(400).json({ message:"Not allowed" });

    const assignment = result.rows[0];

    // notify MDs
    mdSockets.forEach(md => {
      io.to(md.socketId).emit("statusUpdated",{
        employee: req.session.user.username,
        project: assignment.project_name,
        status
      });
    });

    res.json({ success:true, message:`Project ${status}` });
  }catch(err){
    console.error(err);
    res.status(500).json({ success:false });
  }
});

/* PDF DOWNLOAD */
app.get("/report/download", isLoggedIn, async (req,res)=>{
  try{
    let result;
    if(req.session.user.role==="MD"){
      result = await pool.query(
        `SELECT u.username AS employee, a.project_name, a.project_code, a.budget, a.note, a.status, a.created_at
         FROM assignments a
         JOIN users u ON a.employee_id = u.id
         ORDER BY a.created_at DESC`
      );
    }else{
      result = await pool.query(
        `SELECT u.username AS employee, a.project_name, a.project_code, a.budget, a.note, a.status, a.created_at
         FROM assignments a
         JOIN users u ON a.employee_id = u.id
         WHERE a.employee_id=$1
         ORDER BY a.created_at DESC`, [req.session.user.id]
      );
    }

    const doc = new PDFDocument({ margin:30, size:"A4" });
    res.setHeader("Content-Type","application/pdf");
    res.setHeader("Content-Disposition","attachment; filename=assignments_report.pdf");
    doc.pipe(res);

    doc.fontSize(18).text("Assignments Report", { align:"center" });
    doc.moveDown();

    doc.fontSize(12).text("No",50,doc.y,{continued:true});
    doc.text("Employee",80,doc.y,{continued:true});
    doc.text("Project Name",160,doc.y,{continued:true});
    doc.text("Code",280,doc.y,{continued:true});
    doc.text("Budget",340,doc.y,{continued:true});
    doc.text("Note",400,doc.y,{continued:true});
    doc.text("Status",470,doc.y,{continued:true});
    doc.text("Assigned At",520,doc.y);
    doc.moveDown(0.5);

    result.rows.forEach((a,index)=>{
      doc.text(index+1,50,doc.y,{continued:true});
      doc.text(a.employee,80,doc.y,{continued:true});
      doc.text(a.project_name,160,doc.y,{continued:true});
      doc.text(a.project_code,280,doc.y,{continued:true});
      doc.text(a.budget,340,doc.y,{continued:true});
      doc.text(a.note||"-",400,doc.y,{continued:true});
      doc.text(a.status,470,doc.y,{continued:true});
      doc.text(new Date(a.created_at).toLocaleString(),520,doc.y);
      doc.moveDown(0.5);
    });

    doc.end();
  }catch(err){
    console.error(err);
    res.status(500).send("Error generating PDF report");
  }
});

/* LOGOUT */
app.get("/logout", (req,res)=>{
  req.session.destroy(()=> res.redirect("/"));
});

/* ---------------- SERVER ---------------- */
const PORT = process.env.PORT || 4000;
server.listen(PORT, ()=> console.log(`🚀 Server running on http://localhost:${PORT}`));
