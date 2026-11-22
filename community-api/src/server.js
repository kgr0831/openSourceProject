
require("dotenv").config();

const app = require("./app");

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Community API 서버 실행 중: http://localhost:${PORT}`);
});
