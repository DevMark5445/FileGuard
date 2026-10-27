const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function authenticateToken(req, res, next) {
  const authorization = req.get("authorization");
  const [scheme, token] = authorization ? authorization.split(" ") : [];

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "Authentication is required." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (typeof payload !== "object" || typeof payload.sub !== "string") {
      return res.status(401).json({ message: "Your session is invalid. Sign in again." });
    }

    const user = await User.findById(payload.sub).select("+tokenVersion");
    if (!user || user.tokenVersion !== payload.ver) {
      return res.status(401).json({ message: "Your session has expired. Sign in again." });
    }

    req.user = user;
    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError" || error.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Your session has expired. Sign in again." });
    }
    return next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have permission to perform this action." });
    }
    return next();
  };
}

module.exports = { authenticateToken, requireRole };
