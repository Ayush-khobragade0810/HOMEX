import express from "express";
import City from "../models/City.js";

const router = express.Router();

// GET all cities with state and country details
router.get("/", async (req, res) => {
    try {
        const cities = await City.aggregate([
            {
                $lookup: {
                    from: "states",
                    localField: "stateId",
                    foreignField: "stateId",
                    as: "state"
                }
            },
            { $unwind: "$state" },
            {
                $lookup: {
                    from: "countries",
                    localField: "state.countryId",
                    foreignField: "countryId",
                    as: "country"
                }
            },
            { $unwind: "$country" },
            {
                $project: {
                    _id: 1,
                    cityId: 1,
                    cityName: 1,
                    stateId: 1,
                    "state.stateId": 1,
                    "state.stateName": 1,
                    "state.countryId": 1,
                    "country.countryId": 1,
                    "country.countryName": 1
                }
            },
            { $sort: { cityId: 1 } }
        ]);

        // Transform data to match frontend expectations
        const transformedCities = cities.map(city => ({
            id: city.cityId,
            name: city.cityName,
            state_name: city.state.stateName,
            country_name: city.country.countryName,
            stateId: city.stateId,
            countryId: city.state.countryId
        }));

        res.json(transformedCities);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST new city
router.post("/add-city", async (req, res) => {
    try {
        const { name, stateId, countryId } = req.body;

        const newCity = new City({
            cityName: name.trim(),
            stateId: parseInt(stateId)
        });

        await newCity.save();
        res.status(201).json({ message: "City added successfully", city: newCity });
    } catch (err) {
        if (err.code === 11000) {
            res.status(400).json({ message: "City ID already exists" });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

// PUT update city
router.put("/:id", async (req, res) => {
    try {
        const { name, stateId } = req.body;

        const updatedCity = await City.findOneAndUpdate(
            { cityId: parseInt(req.params.id) },
            {
                cityName: name,
                stateId: parseInt(stateId)
            },
            { new: true, runValidators: true }
        );

        if (!updatedCity) {
            return res.status(404).json({ message: "City not found" });
        }

        res.json({ message: "City updated successfully", city: updatedCity });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE city
router.delete("/:id", async (req, res) => {
    try {
        const deletedCity = await City.findOneAndDelete({ cityId: parseInt(req.params.id) });

        if (!deletedCity) {
            return res.status(404).json({ message: "City not found" });
        }

        res.json({ message: "City deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;  // Correct - export the router