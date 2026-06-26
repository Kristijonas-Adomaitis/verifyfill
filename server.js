const express = require("express");
const path = require("path");

const app = express();
const root = path.join(__dirname, "docs");

app.use((req, res, next) => {
  const isDocument =
    req.path === "/" ||
    req.path.endsWith(".html") ||
    !path.extname(req.path);

  if (isDocument) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  next();
});

app.use(
  express.static(root, {
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    },
  })
);

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0");
