// controllers/locationController.js
import Country from '../models/Country.js';
import State from '../models/State.js';
import City from '../models/City.js';
import Area from '../models/Area.js';
import mongoose from 'mongoose';

// Security: Input validation and sanitization
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/[<>$]/g, '');
};

const validateLocationParams = (params) => {
  const { country, state, city } = params;
  const errors = [];
  
  if (country && (country.length > 100 || !/^[a-zA-Z\s\-.,()]+$/.test(country))) {
    errors.push('Invalid country parameter');
  }
  
  if (state && (state.length > 100 || !/^[a-zA-Z\s\-.,()]+$/.test(state))) {
    errors.push('Invalid state parameter');
  }
  
  if (city && (city.length > 100 || !/^[a-zA-Z\s\-.,()]+$/.test(city))) {
    errors.push('Invalid city parameter');
  }
  
  return errors;
};

// Security: Rate limiting storage (in production, use Redis)
const requestCounts = new Map();
const RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 100 }; // 15 minutes, max 100 requests

const checkRateLimit = (ip) => {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT.windowMs;
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, []);
  }
  
  const requests = requestCounts.get(ip).filter(time => time > windowStart);
  requests.push(now);
  requestCounts.set(ip, requests);
  
  return requests.length <= RATE_LIMIT.max;
};

// Helper function to check database connection
const isDBConnected = () => mongoose.connection.readyState === 1;

// Get all countries
export const getCountries = async (req, res) => {
  try {
    // Security: Rate limiting
    const clientIP = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIP)) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.'
      });
    }

    // Security: Set response headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    // Check database connection
    if (!isDBConnected()) {
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable. Database connection failed.'
      });
    }

    // Get data from database
    const countries = await Country.find({})
      .select('countryName -_id')
      .sort({ countryName: 1 })
      .lean();

    if (!countries || countries.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No countries found in database'
      });
    }
    
    const data = countries.map(country => country.countryName);
    
    res.status(200).json({
      success: true,
      data: data,
      count: data.length
    });
    
  } catch (error) {
    console.error('Get countries error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get states by country
export const getStates = async (req, res) => {
  try {
    // Security: Rate limiting
    const clientIP = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIP)) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.'
      });
    }

    // Security: Input validation
    const country = sanitizeInput(req.query.country);
    const validationErrors = validateLocationParams({ country });
    
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input parameters',
        errors: validationErrors
      });
    }

    if (!country) {
      return res.status(400).json({
        success: false,
        message: 'Country parameter is required'
      });
    }

    // Security: Set response headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    // Check database connection
    if (!isDBConnected()) {
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable. Database connection failed.'
      });
    }

    // Security: Use parameterized query (handled by Mongoose)
    const states = await State.find({ country: country })
      .select('stateName -_id')
      .sort({ stateName: 1 })
      .lean();

    if (!states || states.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No states found for country: ${country}`
      });
    }
    
    const data = states.map(state => state.stateName);
    
    res.status(200).json({
      success: true,
      data: data,
      count: data.length
    });
    
  } catch (error) {
    console.error('Get states error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get cities by country and state
export const getCities = async (req, res) => {
  try {
    // Security: Rate limiting
    const clientIP = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIP)) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.'
      });
    }

    // Security: Input validation
    const country = sanitizeInput(req.query.country);
    const state = sanitizeInput(req.query.state);
    const validationErrors = validateLocationParams({ country, state });
    
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input parameters',
        errors: validationErrors
      });
    }

    if (!country || !state) {
      return res.status(400).json({
        success: false,
        message: 'Country and state parameters are required'
      });
    }

    // Security: Set response headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    // Check database connection
    if (!isDBConnected()) {
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable. Database connection failed.'
      });
    }

    // Security: Use parameterized query
    const cities = await City.find({ 
      country: country, 
      state: state 
    })
      .select('cityName -_id')
      .sort({ cityName: 1 })
      .lean();
    
    if (!cities || cities.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No cities found for state: ${state}`
      });
    }
    
    const data = cities.map(city => city.cityName);
    
    res.status(200).json({
      success: true,
      data: data,
      count: data.length
    });
    
  } catch (error) {
    console.error('Get cities error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get areas by country, state and city - FIXED VERSION (only one implementation)
export const getAreas = async (req, res) => {
  try {
    // Security: Rate limiting
    const clientIP = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIP)) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.'
      });
    }

    // Security: Input validation
    const country = sanitizeInput(req.query.country);
    const state = sanitizeInput(req.query.state);
    const city = sanitizeInput(req.query.city);
    const validationErrors = validateLocationParams({ country, state, city });
    
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input parameters',
        errors: validationErrors
      });
    }

    if (!country || !state || !city) {
      return res.status(400).json({
        success: false,
        message: 'Country, state and city parameters are required'
      });
    }

    // Security: Set response headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    // Check database connection
    if (!isDBConnected()) {
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable. Database connection failed.'
      });
    }

    console.log(`🔍 [BACKEND] Searching areas for: ${country}, ${state}, ${city}`);

    // Try multiple query approaches to handle different database structures
    let areas = [];

    // Approach 1: Direct field matching (your current structure)
    areas = await Area.find({ 
      country: { $regex: new RegExp(`^${country}$`, 'i') }, 
      state: { $regex: new RegExp(`^${state}$`, 'i') },
      city: { $regex: new RegExp(`^${city}$`, 'i') } 
    })
      .select('areaName -_id')
      .sort({ areaName: 1 })
      .lean();

    // Approach 2: If no results, try case-insensitive search
    if (!areas || areas.length === 0) {
      areas = await Area.find({ 
        country: { $regex: country, $options: 'i' }, 
        state: { $regex: state, $options: 'i' },
        city: { $regex: city, $options: 'i' } 
      })
        .select('areaName -_id')
        .sort({ areaName: 1 })
        .lean();
    }

    // Approach 3: If still no results, try with cityId structure
    if ((!areas || areas.length === 0) && req.query.cityId) {
      const cityId = parseInt(req.query.cityId);
      if (!isNaN(cityId)) {
        areas = await Area.find({ cityId: cityId })
          .select('areaName -_id')
          .sort({ areaName: 1 })
          .lean();
      }
    }

    console.log(`🔍 [BACKEND] Found ${areas.length} areas for ${city}`);

    // Return empty array instead of 404 if no areas found
    const data = areas.map(area => area.areaName);
    
    res.status(200).json({
      success: true,
      data: data,
      count: data.length,
      message: data.length === 0 ? `No areas found for ${city}` : 'Areas retrieved successfully'
    });
    
  } catch (error) {
    console.error('Get areas error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching areas',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};