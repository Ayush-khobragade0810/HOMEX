import express from "express";
import State from "../models/State.js";

import { cache } from "../utils/helpers.js";

const router = express.Router();

// GET all states with country details
router.get("/", async (req, res) => {
    try {
        const cacheKey = 'master_states';
        const cachedData = cache.get(cacheKey);
        
        if (cachedData) {
            return res.json(cachedData);
        }

        const states = await State.aggregate([
            {
                $lookup: {
                    from: "countries",
                    localField: "countryId",
                    foreignField: "countryId",
                    as: "country"
                }
            },
            { $unwind: "$country" },
            {
                $project: {
                    _id: 1,
                    stateId: 1,
                    stateName: 1,
                    countryId: 1,
                    "country.countryId": 1,
                    "country.countryName": 1
                }
            },
            { $sort: { stateId: 1 } }
        ]);

        // Transform data to match frontend expectations
        const transformedStates = states.map(state => ({
            id: state.stateId,
            stateName: state.stateName,
            countryName: state.country.countryName,
            countryId: state.countryId
        }));

        // Cache for 10 minutes
        cache.set(cacheKey, transformedStates, 600000);

        res.json(transformedStates);
    } catch (err) {
        res.status(500).json({ error: "Failed to load states" });
    }
});

// POST new state
router.post("/add-state", async (req, res) => {
    try {
        const { name, countryId } = req.body;

        // Check if state already exists in this country
        const existingState = await State.findOne({
            stateName: { $regex: `^${name}$`, $options: "i" },
            countryId: parseInt(countryId)
        });

        if (existingState) {
            return res.status(400).json({ message: "State already exists in this country" });
        }

        const newState = new State({
            stateName: name.trim(),
            countryId: parseInt(countryId)
        });

        await newState.save();
        res.status(201).json({
            message: "State added successfully",
            state: {
                id: newState.stateId,
                state_name: newState.stateName,
                countryId: newState.countryId
            }
        });
    } catch (err) {
        if (err.code === 11000) {
            res.status(400).json({ message: "State ID already exists" });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

// PUT update state
router.put("/:id", async (req, res) => {
    try {
        const { name, countryId } = req.body;

        // Check if state name already exists in this country (excluding current state)
        const existingState = await State.findOne({
            stateName: { $regex: `^${name}$`, $options: "i" },
            countryId: parseInt(countryId),
            stateId: { $ne: parseInt(req.params.id) }
        });

        if (existingState) {
            return res.status(400).json({ message: "State name already exists in this country" });
        }

        const updatedState = await State.findOneAndUpdate(
            { stateId: parseInt(req.params.id) },
            {
                stateName: name.trim(),
                countryId: parseInt(countryId)
            },
            { new: true, runValidators: true }
        );

        if (!updatedState) {
            return res.status(404).json({ message: "State not found" });
        }

        res.json({
            message: "State updated successfully",
            state: {
                id: updatedState.stateId,
                state_name: updatedState.stateName,
                countryId: updatedState.countryId
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE state
router.delete("/:id", async (req, res) => {
    try {
        const deletedState = await State.findOneAndDelete({
            stateId: parseInt(req.params.id)
        });

        if (!deletedState) {
            return res.status(404).json({ message: "State not found" });
        }

        res.json({ message: "State deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;  // Correct - export the router