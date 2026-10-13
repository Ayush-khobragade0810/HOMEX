import express from "express";
import State from "../models/State.js";
import Country from "../models/Country.js";

import { cache } from "../utils/helpers.js";
import { ApiError } from "../utils/ApiError.js";
import { validate } from "../middleware/validate.js";
import * as s from "../validators/location.js";

const router = express.Router();

/** 400 when the country picked in the form does not exist. */
const assertCountryExists = async (countryId) => {
    if (!(await Country.exists({ countryId }))) {
        throw ApiError.badRequest("Selected country does not exist");
    }
};

/** 409 when another state with the same name exists in the country. */
const assertUniqueInCountry = async (name, countryId, excludeStateId) => {
    const filter = { stateName: s.exactName(name), countryId };
    if (excludeStateId !== undefined) filter.stateId = { $ne: excludeStateId };
    const existing = await State.findOne(filter);
    if (existing) {
        throw ApiError.conflict(`A state named '${existing.stateName}' already exists in this country`);
    }
};

// GET all states with country details
router.get("/", async (req, res) => {
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
});

// POST new state
router.post("/add-state", validate({ body: s.state }), async (req, res) => {
    const name = req.body.name.trim();
    const countryId = parseInt(req.body.countryId);

    await assertCountryExists(countryId);
    await assertUniqueInCountry(name, countryId);

    const newState = new State({
        stateName: name,
        countryId
    });

    try {
        await newState.save();
    } catch (err) {
        if (err.code === 11000) throw ApiError.conflict("Could not assign a state ID, please try again");
        throw err;
    }
    // A new state affects the states list and the city list (which shows
    // the state name).
    cache.delete('master_states');
    cache.delete('master_cities');
    res.status(201).json({
        message: "State added successfully",
        state: {
            id: newState.stateId,
            state_name: newState.stateName,
            countryId: newState.countryId
        }
    });
});

// PUT update state
router.put("/:id", validate({ params: s.numericIdParams, body: s.state }), async (req, res) => {
    const name = req.body.name.trim();
    const countryId = parseInt(req.body.countryId);
    const stateId = parseInt(req.params.id);

    if (!(await State.exists({ stateId }))) {
        throw ApiError.notFound("State not found");
    }

    await assertCountryExists(countryId);
    await assertUniqueInCountry(name, countryId, stateId);

    const updatedState = await State.findOneAndUpdate(
        { stateId },
        {
            stateName: name,
            countryId
        },
        { new: true, runValidators: true }
    );

    if (!updatedState) {
        throw ApiError.notFound("State not found");
    }

    cache.delete('master_states');
    cache.delete('master_cities');
    res.json({
        message: "State updated successfully",
        state: {
            id: updatedState.stateId,
            state_name: updatedState.stateName,
            countryId: updatedState.countryId
        }
    });
});

// DELETE state
router.delete("/:id", validate({ params: s.numericIdParams }), async (req, res) => {
    const deletedState = await State.findOneAndDelete({
        stateId: parseInt(req.params.id)
    });

    if (!deletedState) {
        throw ApiError.notFound("State not found");
    }

    cache.delete('master_states');
    cache.delete('master_cities');
    res.json({ message: "State deleted successfully" });
});

export default router;  // Correct - export the router
