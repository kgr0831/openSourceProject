const authRoutes = require("./modules/auth/auth.routes");
const express = require("express");
const cors = require("cors");

const app = express();
const sessionMiddleware = require("./config/session");

// 미들웨어 설정
app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(express.json());
app.use(sessionMiddleware);
app.use("/auth", authRoutes);
// 서버 상태 확인 API
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Community API 서버 정상 작동 중!",
  });
});

module.exports = app;
