
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);

const sessionMiddleware = session({
  store: new PgSession({
    conString: process.env.DATABASE_URL,
    tableName: "user_sessions",
    createTableIfMissing: true,
  }),

  secret: process.env.SESSION_SECRET,

  resave: false,
  saveUninitialized: false,

  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
});

module.exports = sessionMiddleware;
