// middleware/employeeAuth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const employeeAuth = async (req, res, next) => {
  if (!req.headers.authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const token = req.headers.authorization.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const employee = await User.findById(decoded.id).select("-password");
    if (!employee) {
      return res.status(401).json({ message: "Employee not found" });
    }

    req.employee = employee;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};
