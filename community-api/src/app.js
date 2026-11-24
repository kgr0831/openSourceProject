
const express = require("express");
const cors = require("cors");

const app = express();

const sessionMiddleware = require("./config/session");
const authRoutes = require("./modules/auth/auth.routes");
const postRoutes = require("./modules/posts/post.routes");

app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(express.json());
app.use(sessionMiddleware);

app.use("/auth", authRoutes);
app.use("/posts", postRoutes);

// 서버 상태 확인 API
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Community API 서버 정상 작동 중!",
  });
});

module.exports = app;
