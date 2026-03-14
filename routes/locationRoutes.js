import express from "express";
import {
  getCountries,
  getStates,
  getCities,
  getAreas
} from "../controllers/locationController.js";

const router = express.Router();

// Get all countries
router.get("/countries", getCountries);

// Get states by country
router.get("/states", getStates);

// Get cities by country and state
router.get("/cities", getCities);

// Get areas by country, state and city
router.get("/areas", getAreas);

export default router;