import mongoose from "mongoose";

const locationSchema = new mongoose.Schema(
  {
    country: {
      type: String,
      required: [true, "Country is required"],
      trim: true,
      minlength: [1, "Country cannot be empty"],
      maxlength: [100, "Country cannot exceed 100 characters"],
      match: [/^[a-zA-Z\s\-\.\(\)]+$/, "Country contains invalid characters"]
    },
    state: {
      type: String,
      required: [true, "State is required"],
      trim: true,
      minlength: [1, "State cannot be empty"],
      maxlength: [100, "State cannot exceed 100 characters"],
      match: [/^[a-zA-Z\s\-\.\(\)]+$/, "State contains invalid characters"]
    },
    city: {
      type: String,
      required: [true, "City is required"],
      trim: true,
      minlength: [1, "City cannot be empty"],
      maxlength: [100, "City cannot exceed 100 characters"],
      match: [/^[a-zA-Z\s\-\.\(\)]+$/, "City contains invalid characters"]
    },
    area: {
      type: String,
      required: [true, "Area is required"],
      trim: true,
      minlength: [1, "Area cannot be empty"],
      maxlength: [100, "Area cannot exceed 100 characters"],
      match: [/^[a-zA-Z0-9\s\-\.\(\)\&]+$/, "Area contains invalid characters"]
    }
  },
  { timestamps: true }
);

// Pre-save middleware to validate data consistency
locationSchema.pre("save", function(next) {
  // Ensure consistent casing for location data
  this.country = this.country.charAt(0).toUpperCase() + this.country.slice(1).toLowerCase();
  this.state = this.state.charAt(0).toUpperCase() + this.state.slice(1).toLowerCase();
  this.city = this.city.charAt(0).toUpperCase() + this.city.slice(1).toLowerCase();
  this.area = this.area.charAt(0).toUpperCase() + this.area.slice(1).toLowerCase();
  
  // Remove extra spaces
  this.country = this.country.replace(/\s+/g, " ").trim();
  this.state = this.state.replace(/\s+/g, " ").trim();
  this.city = this.city.replace(/\s+/g, " ").trim();
  this.area = this.area.replace(/\s+/g, " ").trim();
  
  next();
});

// Create indexes for better performance
locationSchema.index({ country: 1 });
locationSchema.index({ country: 1, state: 1 });
locationSchema.index({ country: 1, state: 1, city: 1 });
locationSchema.index({ country: 1, state: 1, city: 1, area: 1 }, { unique: true });

// Static method for finding locations by hierarchy
locationSchema.statics.findByHierarchy = function(country, state, city, area) {
  const query = {};
  if (country) query.country = new RegExp(`^${country}$`, "i");
  if (state) query.state = new RegExp(`^${state}$`, "i");
  if (city) query.city = new RegExp(`^${city}$`, "i");
  if (area) query.area = new RegExp(`^${area}$`, "i");
  
  return this.find(query);
};

// Instance method for getting full address
locationSchema.methods.getFullAddress = function() {
  return `${this.area}, ${this.city}, ${this.state}, ${this.country}`;
};

export default mongoose.model("Location", locationSchema);