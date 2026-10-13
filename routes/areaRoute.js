import express from "express";
import Area from "../models/Area.js";

import { cache } from "../utils/helpers.js";
import { ApiError } from "../utils/ApiError.js";
import { validate } from "../middleware/validate.js";
import * as s from "../validators/location.js";

const router = express.Router();

const AREAS_CACHE_KEY = "master_areas";

// Single serialisation shape for areas, so GET / POST / PUT all hand the client
// the same fields (notably `id`, which callers store as employee.areaId).
const serializeArea = (a) => ({
    id: a._id,
    _id: a._id,
    areaName: a.areaName,
    city: a.city,
    state: a.state,
    country: a.country,
    pincode: a.pincode || "",
    description: a.description || ""
});

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

/** Trimmed, model-shaped fields from a validated request body. */
const areaFields = (b) => ({
    areaName: b.areaName.trim(),
    city: b.city.trim(),
    state: b.state.trim(),
    country: b.country.trim(),
    pincode: b.pincode?.trim() || undefined,
    description: b.description?.trim() || undefined
});

/** 409 when the same area name already exists in this city (case-insensitive). */
const assertUniqueInCity = async (f, excludeId) => {
    const filter = {
        areaName: s.exactName(f.areaName),
        city: s.exactName(f.city),
        state: s.exactName(f.state),
        country: s.exactName(f.country)
    };
    if (excludeId) filter._id = { $ne: excludeId };
    const existing = await Area.findOne(filter).lean();
    if (existing) {
        throw ApiError.conflict(`An area named '${existing.areaName}' already exists in ${existing.city}`);
    }
};

const duplicateError = (f) =>
    ApiError.conflict(`An area named '${f.areaName}' already exists in ${f.city}`);

// GET all areas
router.get("/", async (req, res) => {
    const cached = cache.get(AREAS_CACHE_KEY);
    if (cached) return res.json(cached);

    const areas = await Area.find().sort({ areaName: 1 }).lean();

    const data = areas.map(serializeArea);

    cache.set(AREAS_CACHE_KEY, data, 600000); // 10 minutes
    res.json(data);
});

// POST new area
router.post("/add-area", validate({ body: s.area }), async (req, res) => {
    const fields = areaFields(req.body);

    await assertUniqueInCity(fields);

    const newArea = new Area(fields);

    try {
        await newArea.save();
    } catch (err) {
        if (err.code === 11000) throw duplicateError(fields);
        throw err;
    }
    cache.delete(AREAS_CACHE_KEY); // so the new area shows immediately

    res.status(201).json({ message: "Area added successfully", area: serializeArea(newArea) });
});

// PUT update area (by Mongo _id)
router.put("/:id", validate({ params: s.areaIdParams, body: s.area }), async (req, res) => {
    const fields = areaFields(req.body);

    if (!(await Area.exists({ _id: req.params.id }))) {
        throw ApiError.notFound("Area not found");
    }

    await assertUniqueInCity(fields, req.params.id);

    let updatedArea;
    try {
        updatedArea = await Area.findByIdAndUpdate(
            req.params.id,
            fields,
            { new: true, runValidators: true }
        );
    } catch (err) {
        if (err.code === 11000) throw duplicateError(fields);
        throw err;
    }

    if (!updatedArea) {
        throw ApiError.notFound("Area not found");
    }

    cache.delete(AREAS_CACHE_KEY);
    res.json({ message: "Area updated successfully", area: serializeArea(updatedArea) });
});

// DELETE area (by Mongo _id)
router.delete("/:id", validate({ params: s.areaIdParams }), async (req, res) => {
    const deletedArea = await Area.findByIdAndDelete(req.params.id);

    if (!deletedArea) {
        throw ApiError.notFound("Area not found");
    }

    cache.delete(AREAS_CACHE_KEY);
    res.json({ message: "Area deleted successfully" });
});

export default router;
