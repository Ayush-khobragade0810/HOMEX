import express from "express";
import Country from "../models/Country.js";

const router = express.Router();

// GET all countries
router.get("/", async (req, res) => {
    try {
        const countries = await Country.find().sort({ countryId: 1 });
        
        // Transform data to match frontend expectations
        const transformedCountries = countries.map(country => ({
            id: country.countryId,
            name: country.countryName
        }));
        
        res.json(transformedCountries);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST new country
router.post("/add-country", async (req, res) => {
    try {
        const { name } = req.body;
        
        // Check if country already exists
        const existingCountry = await Country.findOne({ 
            countryName: { $regex: `^${name}$`, $options: "i" } 
        });
        
        if (existingCountry) {
            return res.status(400).json({ message: "Country already exists" });
        }

        const newCountry = new Country({
            countryName: name.trim()
        });

        await newCountry.save();
        res.status(201).json({ 
            message: "Country added successfully", 
            country: {
                id: newCountry.countryId,
                name: newCountry.countryName
            }
        });
    } catch (err) {
        if (err.code === 11000) {
            res.status(400).json({ message: "Country ID already exists" });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

// PUT update country
router.put("/:id", async (req, res) => {
    try {
        const { name } = req.body;
        
        // Check if country name already exists (excluding current country)
        const existingCountry = await Country.findOne({ 
            countryName: { $regex: `^${name}$`, $options: "i" },
            countryId: { $ne: parseInt(req.params.id) }
        });
        
        if (existingCountry) {
            return res.status(400).json({ message: "Country name already exists" });
        }

        const updatedCountry = await Country.findOneAndUpdate(
            { countryId: parseInt(req.params.id) },
            { countryName: name.trim() },
            { new: true, runValidators: true }
        );

        if (!updatedCountry) {
            return res.status(404).json({ message: "Country not found" });
        }

        res.json({ 
            message: "Country updated successfully", 
            country: {
                id: updatedCountry.countryId,
                name: updatedCountry.countryName
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE country
router.delete("/:id", async (req, res) => {
    try {
        const deletedCountry = await Country.findOneAndDelete({ 
            countryId: parseInt(req.params.id) 
        });
        
        if (!deletedCountry) {
            return res.status(404).json({ message: "Country not found" });
        }

        res.json({ message: "Country deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;  // Correct - export the router
