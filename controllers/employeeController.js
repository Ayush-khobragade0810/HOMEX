// controllers/employeeController.js
import Employee from '../models/adminEmployee.js';
import mongoose from 'mongoose';

export const getProfile = async (req, res) => {
  // Use findOne with the correct query if req.user.id maps to _id or empId
  // Assuming req.user.id is the _id from the token
  const employee = await Employee.findById(req.user.id);
  res.json(employee);
};


export const getTopTechnicians = async (req, res) => {
  const techs = await Employee.find().sort({ earnings: -1 }).limit(10);
  res.json(
    techs.map((t, i) => ({
      rank: i + 1,
      id: t.empId, // usage of empId from adminEmployee schema
      name: t.empName, // usage of empName
      rating: t.rating || 0,
      jobs: t.completedJobs || 0, // usage of completedJobs
      earnings: t.earnings || 0
    }))
  );
};

// Get employee settings
export const getEmployeeSettings = async (req, res) => {
  try {
    const { id } = req.params;

    let query = {};

    // Smart ID Detection
    if (mongoose.Types.ObjectId.isValid(id)) {
      query._id = id;
    } else if (!isNaN(id)) {
      // It's a number, so it must be the empId
      query.empId = parseInt(id, 10);
    } else {
      // Fallback: treat as string empId (though schema says Number, good for safety)
      query.empId = id;
    }

    const employee = await Employee.findOne(query).select('settings');

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    res.json({
      success: true,
      settings: employee.settings || {
        notifications: true,
        darkMode: false,
        emailAlerts: true,
        twoFactor: false
      }
    });

  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching settings'
    });
  }
};

// Update employee settings
export const updateEmployeeSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    let query = {};

    // Smart ID Detection
    if (mongoose.Types.ObjectId.isValid(id)) {
      query._id = id;
    } else if (!isNaN(id)) {
      query.empId = parseInt(id, 10);
    } else {
      query.empId = id;
    }

    // Find target employee to verify and get their _id
    const employee = await Employee.findOne(query).select('settings _id empId');

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Authorization check
    const requestUserId = req.user.id.toString();
    const targetObjectId = employee._id.toString();

    if (req.user.role !== 'admin' && requestUserId !== targetObjectId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update these settings'
      });
    }

    // Validate updates
    const allowedSettings = ['notifications', 'darkMode', 'emailAlerts', 'twoFactor'];
    const invalidKeys = Object.keys(updates).filter(key => !allowedSettings.includes(key));

    if (invalidKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid settings: ${invalidKeys.join(', ')}`,
        allowedSettings
      });
    }

    const updateQuery = {};
    Object.keys(updates).forEach(key => {
      updateQuery[`settings.${key}`] = updates[key];
    });

    const updatedEmployee = await Employee.findByIdAndUpdate(
      employee._id,
      {
        $set: {
          ...updateQuery,
          updatedAt: new Date()
        }
      },
      {
        new: true,
        runValidators: true
      }
    ).select('settings');

    res.json({
      success: true,
      message: 'Settings updated successfully',
      settings: updatedEmployee.settings
    });

  } catch (error) {
    console.error('Update settings error:', error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error updating settings'
    });
  }
};

// Deactivate account
export const deactivateAccount = async (req, res) => {
  try {
    const { id } = req.params;

    let query = {};

    // Smart ID Detection
    if (mongoose.Types.ObjectId.isValid(id)) {
      query._id = id;
    } else if (!isNaN(id)) {
      query.empId = parseInt(id, 10);
    } else {
      query.empId = id;
    }

    // Find target employee
    const employee = await Employee.findOne(query).select('status _id empId');

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Authorization check
    const requestUserId = req.user.id.toString();
    const targetObjectId = employee._id.toString();

    if (req.user.role !== 'admin' && requestUserId !== targetObjectId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to deactivate this account'
      });
    }

    // Update status to Inactive
    await Employee.findByIdAndUpdate(employee._id, {
      $set: { status: 'Inactive' }
    });

    res.json({
      success: true,
      message: 'Account request submitted successfully. An admin will review it.'
    });

  } catch (error) {
    console.error('Deactivate account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during deactivation'
    });
  }
};

// Update Employee Profile (Self) - Fix for 400 Bad Request
export const updateProfile = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`👤 Update Profile Request for ID: ${id}`);
    console.log('📦 Request Body:', req.body);

    const { empName, phone, address, bio, specialties, certifications, avatar, email } = req.body;

    // Smart ID Detection
    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query._id = id;
    } else if (!isNaN(id)) {
      query.empId = parseInt(id, 10);
    } else {
      query.empId = id;
    }

    const employee = await Employee.findOne(query);

    if (!employee) {
      console.log('❌ Employee not found');
      return res.status(404).json({ message: 'Employee not found' });
    }

    // Authorization check: User must be updating themselves (email matches token)
    // Note: usage of req.user.email from token is secure
    if (employee.email !== req.user.email) {
      console.log(`⛔ Unauthorized: Token email ${req.user.email} != Target email ${employee.email}`);
      return res.status(403).json({ message: 'Not authorized to update this profile' });
    }

    // Fields allowed to be updated
    const updateData = {};
    if (empName) updateData.empName = empName;
    if (phone) updateData.phone = phone;
    if (address) updateData.address = address;
    if (bio) updateData.bio = bio;
    if (specialties) updateData.specialties = specialties;
    if (certifications) updateData.certifications = certifications;
    if (avatar) updateData.avatar = avatar;
    if (email) updateData.email = email; // Allow email update

    console.log('📝 Update Data Prepared:', updateData);

    const updatedEmployee = await Employee.findOneAndUpdate(
      { _id: employee._id },
      { $set: updateData },
      { new: true, runValidators: false }
    );

    console.log('✅ Profile Updated Successfully');

    // --- SYNC WITH USER MODEL (For Login) ---
    // Since login uses the User collection, we must sync changes (especially Email) 
    // to the corresponding User record.
    try {
      // Dynamic import to avoid circular dependency issues
      const User = (await import('../models/User.js')).default;

      // Find User by the ORIGINAL email (before update)
      // We use employee.email because that was the state before the findOneAndUpdate above?
      // No, wait. 'employee' variable holds the doc fetched BEFORE update. Correct.
      const linkedUser = await User.findOne({ email: employee.email });

      if (linkedUser) {
        console.log(`🔄 Syncing changes to User record (ID: ${linkedUser._id})...`);
        const userUpdates = {};

        // Map Employee fields to User fields
        if (empName) userUpdates.name = empName;
        if (email) userUpdates.email = email;
        if (phone) userUpdates.phone = phone;
        if (address) userUpdates.address = address;
        if (avatar) userUpdates.avatar = avatar;

        if (Object.keys(userUpdates).length > 0) {
          await User.findByIdAndUpdate(linkedUser._id, { $set: userUpdates });
          console.log('✅ User record synced successfully');
        }
      } else {
        console.warn('⚠️ Linked User record not found for sync. Login might be affected if email was changed.');
      }
    } catch (syncErr) {
      console.error('❌ Failed to sync with User model:', syncErr);
      // Don't fail the request, just log it.
    }
    // ----------------------------------------

    res.json(updatedEmployee);

  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ message: 'Failed to update profile', error: err.message });
  }
};
