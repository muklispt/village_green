// Profile Service API calls
import api from "./api.js";

/**
 * Get the current authenticated user's profile
 * @returns {Promise} Axios response containing profile data
 */
export const getProfile = () => {
  return api.get("/account/profile/");
};

/**
 * Update the current user's profile
 * @param {Object} data - profile fields to update (full_name, profileImage, phone, address, city, pincode)
 * @returns {Promise} Axios response
 */
export const updateProfile = (data) => {
  return api.put("/account/profile/", data);
};

export default {
  getProfile,
  updateProfile,
};
