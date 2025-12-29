const express = require("express");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const pgSession = require("connect-pg-simple")(session);
const webpush = require("web-push");

const app = express();

/* ---------- CONFIG ---------- */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------- DATABASE ---------- */
const pool = new Pool({
  user: "firstdemo_examle_user",
  host: "dpg-d50evbfgi27c73aje1pg-a.oregon-postgres.render.com",
  database: "firstdemo_examle",
  password: "6LBDu09slQHqq3r0GcwbY1nPera4H5Kk",
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

/* ---------- SESSION ---------- */
app.use(
  session({
    store: new pgSession({ pool }),
    secret: "secret",
    resave: false,
    saveUninitialized: false
  })
);

/* ---------- WEB PUSH ---------- */
webpush.setVapidDetails(
  "mailto:la4400512@gmail.com",
  "BHDI3OEuwpmcJ9hNAMKq39kgR79uTW-1W5HhWdkXI5oG399EDM7piZb6VRomYGv8xvyFbp-mI2n7NaefIfY0FWc",
  "JJZI-FZp8dX0_SDkuZ5GV8KdGFiSjdjKoEYR_Z1fygA"
);

/* ---------- MIDDLEWARE ---------- */
const isLoggedIn = (req, res, next) =>
  req.session.user ? next() : res.redirect("/");

const isMD = (req, res, next) =>
  req.session.user.role === "MD" ? next() : res.send("Access Denied");

/* ---------- ROUTES ---------- */

// LOGIN
app.get("/", (req, res) => res.render("login", { error: null }));

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const r = await pool.query("SELECT * FROM users WHERE email=$1", [email]);

  if (!r.rowCount)
    return res.render("login", { error: "User not found" });

  if (!(await bcrypt.compare(password, r.rows[0].password)))
    return res.render("login", { error: "Wrong password" });

  req.session.user = {
    id: r.rows[0].id,
    username: r.rows[0].username,
    role: r.rows[0].role
  };

  res.redirect("/dashboard");
});

// DASHBOARD
app.get("/dashboard", isLoggedIn, (req, res) => {
  res.render("dashboard", req.session.user);
});

// ASSIGN PAGE (MD)
app.get("/assign", isLoggedIn, isMD, async (req, res) => {
  const e = await pool.query(
    "SELECT id, username FROM users WHERE role!='MD'"
  );
  res.render("assign", { employees: e.rows });
});

// ASSIGN ACTION
app.post("/assign", isLoggedIn, isMD, async (req, res) => {
  const {
    "assign-to": empId,
    budget,
    "project-name": name,
    "project-code": code,
    "additional-note": note
  } = req.body;

  await pool.query(
    `INSERT INTO assignments(employee_id,budget,project_name,project_code,note,status)
     VALUES($1,$2,$3,$4,$5,'Pending')`,
    [empId, budget, name, code, note]
  );

  // SEND WINDOWS NOTIFICATION
  const subs = await pool.query(
    "SELECT subscription FROM push_subscriptions WHERE user_id=$1",
    [empId]
  );

  const payload = JSON.stringify({
    title: "New Project Assigned",
    body: `${name} (Budget: ${budget})`
  });

  subs.rows.forEach(s =>
    webpush.sendNotification(s.subscription, payload)
  .catch(err => console.error("Push error:", err))
);


  res.json({ message: "Project Assigned Successfully" });
});

// REPORT
app.get("/report", isLoggedIn, async (req, res) => {
  const q =
    req.session.user.role === "MD"
      ? `SELECT a.*,u.username employee FROM assignments a JOIN users u ON u.id=a.employee_id`
      : `SELECT a.*,u.username employee FROM assignments a JOIN users u ON u.id=a.employee_id WHERE employee_id=$1`;

  const r =
    req.session.user.role === "MD"
      ? await pool.query(q)
      : await pool.query(q, [req.session.user.id]);

  res.render("report", {
    assignments: r.rows,
    role: req.session.user.role
  });
});

// SAVE PUSH TOKEN
app.post("/save-subscription", isLoggedIn, async (req, res) => {
  await pool.query(
    `INSERT INTO push_subscriptions(user_id, subscription)
     VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET subscription=$2`,
    [req.session.user.id, req.body]
  );
  res.json({ success: true });
});

//update status
app.post("/update-status", isLoggedIn, async (req, res) => {
  const { assignmentId, status } = req.body;

  // Only employee can update their own assignment
  const r = await pool.query(
    `UPDATE assignments
     SET status = $1
     WHERE id = $2 AND employee_id = $3
     RETURNING *`,
    [status, assignmentId, req.session.user.id]
  );

  if (!r.rowCount) {
    return res.send("Not allowed");
  }

  res.redirect("/report");
});


// LOGOUT
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
