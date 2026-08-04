import express from "express";
import Area from "../models/Area.js";

import { cache } from "../utils/helpers.js";

const router = express.Router();

const AREAS_CACHE_KEY = "master_areas";

/**
 * Area master CRUD (admin).
 *
 * IMPORTANT: the Area model stores location as strings (areaName, city, state,
 * country) with a compound unique index. The customer booking flow
 * (bookingController.js / locationController.js) creates and searches areas by
 * exactly those string fields, so this admin route MUST use the same shape —
 * otherwise admin-created areas are invisible to the booking form, and inserts
 * fail the model's `required` validation. (An earlier version of this route
 * used non-existent `areaId`/`cityId` fields, which 500'd on every add.)
 */

// GET all areas
router.get("/", async (req, res) => {
    try {
        const cached = cache.get(AREAS_CACHE_KEY);
        if (cached) return res.json(cached);

        const areas = await Area.find().sort({ areaName: 1 }).lean();

        const data = areas.map((a) => ({
            id: a._id,
            _id: a._id,
            areaName: a.areaName,
            city: a.city,
            state: a.state,
            country: a.country,
            pincode: a.pincode || "",
            description: a.description || ""
        }));

        cache.set(AREAS_CACHE_KEY, data, 600000); // 10 minutes
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: "Failed to load areas" });
    }
});

// POST new area
router.post("/add-area", async (req, res) => {
    try {
        const { areaName, city, state, country, pincode, description } = req.body;

        if (!areaName?.trim() || !city?.trim() || !state?.trim() || !country?.trim()) {
            return res.status(400).json({
                message: "Area name, city, state and country are required"
            });
        }

        const newArea = new Area({
            areaName: areaName.trim(),
            city: city.trim(),
            state: state.trim(),
            country: country.trim(),
            pincode: pincode?.trim() || undefined,
            description: description?.trim() || undefined
        });

        await newArea.save();
        cache.delete(AREAS_CACHE_KEY); // so the new area shows immediately

        res.status(201).json({ message: "Area added successfully", area: newArea });
    } catch (err) {
        if (err.code === 11000) {
            res.status(400).json({ message: "This area already exists in the selected city" });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

// PUT update area (by Mongo _id)
router.put("/:id", async (req, res) => {
    try {
        const { areaName, city, state, country, pincode, description } = req.body;

        if (!areaName?.trim() || !city?.trim() || !state?.trim() || !country?.trim()) {
            return res.status(400).json({
                message: "Area name, city, state and country are required"
            });
        }

        const updatedArea = await Area.findByIdAndUpdate(
            req.params.id,
            {
                areaName: areaName.trim(),
                city: city.trim(),
                state: state.trim(),
                country: country.trim(),
                pincode: pincode?.trim() || undefined,
                description: description?.trim() || undefined
            },
            { new: true, runValidators: true }
        );

        if (!updatedArea) {
            return res.status(404).json({ message: "Area not found" });
        }

        cache.delete(AREAS_CACHE_KEY);
        res.json({ message: "Area updated successfully", area: updatedArea });
    } catch (err) {
        if (err.code === 11000) {
            res.status(400).json({ message: "This area already exists in the selected city" });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

// DELETE area (by Mongo _id)
router.delete("/:id", async (req, res) => {
    try {
        const deletedArea = await Area.findByIdAndDelete(req.params.id);

        if (!deletedArea) {
            return res.status(404).json({ message: "Area not found" });
        }

        cache.delete(AREAS_CACHE_KEY);
        res.json({ message: "Area deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
