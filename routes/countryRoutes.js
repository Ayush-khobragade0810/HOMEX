import express from "express";
import Country from "../models/Country.js";

import { cache } from "../utils/helpers.js";
import { ApiError } from "../utils/ApiError.js";
import { validate } from "../middleware/validate.js";
import * as s from "../validators/location.js";

const router = express.Router();

const clearCaches = () => {
    cache.delete('master_countries');
    cache.delete('master_states');
    cache.delete('master_cities');
};

// GET all countries
router.get("/", async (req, res) => {
    const cacheKey = 'master_countries';
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
        return res.json(cachedData);
    }

    const countries = await Country.find().sort({ countryId: 1 }).lean();

    // Transform data to match frontend expectations
    const transformedCountries = countries.map(country => ({
        id: country.countryId,
        name: country.countryName
    }));

    // Cache for 10 minutes
    cache.set(cacheKey, transformedCountries, 600000);

    res.json(transformedCountries);
});

// POST new country
router.post("/add-country", validate({ body: s.country }), async (req, res) => {
    const name = req.body.name.trim();

    // Check if country already exists (case-insensitive)
    const existingCountry = await Country.findOne({ countryName: s.exactName(name) });

    if (existingCountry) {
        throw ApiError.conflict(`A country named '${existingCountry.countryName}' already exists`);
    }

    const newCountry = new Country({
        countryName: name
    });

    try {
        await newCountry.save();
    } catch (err) {
        if (err.code === 11000) {
            throw ApiError.conflict(err.keyValue?.countryName !== undefined
                ? `A country named '${name}' already exists`
                : "Could not assign a country ID, please try again");
        }
        throw err;
    }
    // Adding a country affects the countries list and the state/city lists
    // (which display the country name), so refresh all three.
    clearCaches();
    res.status(201).json({
        message: "Country added successfully",
        country: {
            id: newCountry.countryId,
            name: newCountry.countryName
        }
    });
});

// PUT update country
router.put("/:id", validate({ params: s.numericIdParams, body: s.country }), async (req, res) => {
    const name = req.body.name.trim();
    const countryId = parseInt(req.params.id);

    // Check if country name already exists (excluding current country)
    const existingCountry = await Country.findOne({
        countryName: s.exactName(name),
        countryId: { $ne: countryId }
    });

    if (existingCountry) {
        throw ApiError.conflict(`A country named '${existingCountry.countryName}' already exists`);
    }

    let updatedCountry;
    try {
        updatedCountry = await Country.findOneAndUpdate(
            { countryId },
            { countryName: name },
            { new: true, runValidators: true }
        );
    } catch (err) {
        if (err.code === 11000) throw ApiError.conflict(`A country named '${name}' already exists`);
        throw err;
    }

    if (!updatedCountry) {
        throw ApiError.notFound("Country not found");
    }

    clearCaches();
    res.json({
        message: "Country updated successfully",
        country: {
            id: updatedCountry.countryId,
            name: updatedCountry.countryName
        }
    });
});

// DELETE country
router.delete("/:id", validate({ params: s.numericIdParams }), async (req, res) => {
    const deletedCountry = await Country.findOneAndDelete({
        countryId: parseInt(req.params.id)
    });

    if (!deletedCountry) {
        throw ApiError.notFound("Country not found");
    }

    clearCaches();
    res.json({ message: "Country deleted successfully" });
});

export default router;  // Correct - export the router
