// middleware/employeeAuth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const employeeAuth = async (req, res, next) => {
  if (!req.headers.authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Not authorized, no token provided", error: "Not authorized, no token provided", code: "NO_TOKEN" });
  }

  try {
    const token = req.headers.authorization.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const employee = await User.findById(decoded.id).select("-password");
    if (!employee) {
      return res.status(401).json({ success: false, message: "Employee account not found", error: "Employee account not found", code: "ACCOUNT_NOT_FOUND" });
    }

    req.employee = employee;
    next();
  } catch (err) {
    const expired = err.name === "TokenExpiredError";
    const message = expired ? "Your session has expired. Please log in again." : "Invalid authentication token";
    return res.status(401).json({ success: false, message, error: message, code: expired ? "TOKEN_EXPIRED" : "INVALID_TOKEN" });
  }
};
