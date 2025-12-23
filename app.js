const express = require("express");
const path = require("path");
const session = require("express-session");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");

const app = express();
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---------------- DATABASE ----------------
const pool = new Pool({
  user: "firstdemo_examle_user",
  host: "dpg-d50evbfgi27c73aje1pg-a.oregon-postgres.render.com",
  database: "firstdemo_examle",
  password: "6LBDu09slQHqq3r0GcwbY1nPera4H5Kk",
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

// Check DB
pool.query("SELECT NOW()", (err, res) => {
  if (err) console.log(err);
  else console.log("DB Connected");
});


// ---------------- SESSION ----------------
const pgSession = require("connect-pg-simple")(session);

app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "session"
    }),
    secret: process.env.SESSION_SECRET || "dev_secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);




// ---------------- EMAIL ----------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "la4400512@gmail.com",
    pass: "zsfs dvwg peso xokp"
  }
});

// ---------------- MIDDLEWARE ----------------
function isLoggedIn(req, res, next) {
  if (!req.session.user) return res.redirect("/");
  next();
}

function isMD(req, res, next) {
  if (req.session.user.role !== "MD") {
    console.log("session user:",req.session.user);
    return res.send("Access denied. Only MD can assign projects.");
  }
  next();
}

// ---------------- ROUTES ----------------

// LOGIN PAGE
app.get("/", (req, res) => {
  res.render("login", { error: null });
});

// LOGIN POST
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query(
    "SELECT * FROM users WHERE email=$1",
    [email]
  );

  if (result.rowCount === 0)
    return res.render("login", { error: "User not found" });

  const user = result.rows[0];
  const match = await bcrypt.compare(password, user.password);

  if (!match)
    return res.render("login", { error: "Wrong password" });

  // STORE USER IN SESSION
  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role
  };

  res.redirect("/procurement");
});

// DASHBOARD
app.get("/procurement", isLoggedIn, (req, res) => {
  res.render("procurement", {
    username: req.session.user.username,
    role: req.session.user.role
  });
});

// ASSIGN FORM (ONLY MD)
app.get("/assign", isLoggedIn, isMD, async (req, res) => {
  const result = await pool.query(
    "SELECT id, username FROM users ORDER BY username"
  );
  res.render("assign", { employees: result.rows });
});

// ASSIGN POST
app.post("/assign", isLoggedIn, isMD, async (req, res) => {
  console.log("Form Data:", req.body);

  const { "assign-to": empId, budget, "project-name": name, "project-code": code, "additional-note": note } = req.body;

  await pool.query(
    `INSERT INTO assignments (employee_id, budget, project_name, project_code, note)
     VALUES ($1,$2,$3,$4,$5)`,
    [empId, budget, name, code, note]
  );

  const emp = await pool.query(
    "SELECT email, username FROM users WHERE id=$1",
    [empId]
  );

  await transporter.sendMail({
    to: emp.rows[0].email,
    subject: "Project Assigned",
    html: `<p>Hello ${emp.rows[0].username},<br>
           Project <b>${name}</b> has been assigned to you.</p>`
  });

  res.json({ success: true, message: "Assigned & Email Sent" });
});

// LOGOUT
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// ---------------- SERVER ----------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


