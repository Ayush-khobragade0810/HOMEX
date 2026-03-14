import express from "express";
import Area from "../models/Area.js";

const router = express.Router();

// GET all areas with city details
router.get("/", async (req, res) => {
    try {
        const areas = await Area.aggregate([
            {
                $lookup: {
                    from: "cities",
                    localField: "cityId",
                    foreignField: "cityId",
                    as: "city"
                }
            },
            {
                $unwind: {
                    path: "$city",
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $project: {
                    _id: 0,
                    id: "$areaId",
                    name: "$areaName",
                    cityId: 1,
                    cityName: { $ifNull: ["$city.cityName", "Unknown City"] },
                    pincode: 1,
                    description: 1
                }
            },
            { $sort: { name: 1 } }
        ]);
        res.json(areas);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST new area
router.post("/add-area", async (req, res) => {
    try {
        const { areaName, cityId, pincode, description } = req.body;

        const newArea = new Area({
            areaName,
            cityId: parseInt(cityId),
            pincode,
            description
        });

        await newArea.save();
        res.status(201).json({ message: "Area added successfully", area: newArea });
    } catch (err) {
        if (err.code === 11000) {
            res.status(400).json({ message: "Area ID already exists" });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

// PUT update area
router.put("/:id", async (req, res) => {
    try {
        const { areaName, cityId, pincode, description } = req.body;

        const updatedArea = await Area.findOneAndUpdate(
            { areaId: parseInt(req.params.id) },
            {
                areaName,
                cityId: parseInt(cityId),
                pincode,
                description
            },
            { new: true, runValidators: true }
        );

        if (!updatedArea) {
            return res.status(404).json({ message: "Area not found" });
        }

        res.json({ message: "Area updated successfully", area: updatedArea });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE area
router.delete("/:id", async (req, res) => {
    try {
        const deletedArea = await Area.findOneAndDelete({ areaId: parseInt(req.params.id) });

        if (!deletedArea) {
            return res.status(404).json({ message: "Area not found" });
        }

        res.json({ message: "Area deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;  // Correct - export the router