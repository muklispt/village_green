/**
 * Green Village - Re-export wrapper for Razorpay script loading and checkout launcher.
 * Facilitates direct importing from utils/loadRazorpay.js.
 */
export {
  loadRazorpayScript,
  openRazorpayCheckout,
  RAZORPAY_SCRIPT_URL,
  _resetScriptLoader,
} from "../services/razorpayService.js";

import { loadRazorpayScript } from "../services/razorpayService.js";
export default loadRazorpayScript;

