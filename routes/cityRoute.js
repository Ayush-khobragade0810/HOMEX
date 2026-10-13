import express from "express";
import City from "../models/City.js";
import State from "../models/State.js";

import { cache } from "../utils/helpers.js";
import { ApiError } from "../utils/ApiError.js";
import { validate } from "../middleware/validate.js";
import * as s from "../validators/location.js";

const router = express.Router();

/** 400 when the state picked in the form does not exist. */
const assertStateExists = async (stateId) => {
    if (!(await State.exists({ stateId }))) {
        throw ApiError.badRequest("Selected state does not exist");
    }
};

/** 409 when another city with the same name exists in the state. */
const assertUniqueInState = async (name, stateId, excludeCityId) => {
    const filter = { cityName: s.exactName(name), stateId };
    if (excludeCityId !== undefined) filter.cityId = { $ne: excludeCityId };
    const existing = await City.findOne(filter);
    if (existing) {
        throw ApiError.conflict(`A city named '${existing.cityName}' already exists in this state`);
    }
};

// GET all cities with state and country details
router.get("/", async (req, res) => {
    const cacheKey = 'master_cities';
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
        return res.json(cachedData);
    }

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

    // Cache for 10 minutes
    cache.set(cacheKey, transformedCities, 600000);

    res.json(transformedCities);
});

// POST new city
router.post("/add-city", validate({ body: s.city }), async (req, res) => {
    const name = req.body.name.trim();
    const stateId = parseInt(req.body.stateId);

    await assertStateExists(stateId);
    await assertUniqueInState(name, stateId);

    const newCity = new City({
        cityName: name,
        stateId
    });

    try {
        await newCity.save();
    } catch (err) {
        if (err.code === 11000) throw ApiError.conflict("Could not assign a city ID, please try again");
        throw err;
    }
    cache.delete('master_cities');
    res.status(201).json({ message: "City added successfully", city: newCity });
});

// PUT update city
router.put("/:id", validate({ params: s.numericIdParams, body: s.city }), async (req, res) => {
    const name = req.body.name.trim();
    const stateId = parseInt(req.body.stateId);
    const cityId = parseInt(req.params.id);

    if (!(await City.exists({ cityId }))) {
        throw ApiError.notFound("City not found");
    }

    await assertStateExists(stateId);
    await assertUniqueInState(name, stateId, cityId);

    const updatedCity = await City.findOneAndUpdate(
        { cityId },
        {
            cityName: name,
            stateId
        },
        { new: true, runValidators: true }
    );

    if (!updatedCity) {
        throw ApiError.notFound("City not found");
    }

    cache.delete('master_cities');
    res.json({ message: "City updated successfully", city: updatedCity });
});

// DELETE city
router.delete("/:id", validate({ params: s.numericIdParams }), async (req, res) => {
    const deletedCity = await City.findOneAndDelete({ cityId: parseInt(req.params.id) });

    if (!deletedCity) {
        throw ApiError.notFound("City not found");
    }

    cache.delete('master_cities');
    res.json({ message: "City deleted successfully" });
});

export default router;  // Correct - export the router
