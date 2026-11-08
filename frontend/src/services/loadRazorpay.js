/**
 * Green Village - Re-export wrapper for Razorpay script loading and checkout launcher.
 * Facilitates direct importing as loadRazorpay.js.
 */
export {
  loadRazorpayScript,
  openRazorpayCheckout,
  RAZORPAY_SCRIPT_URL,
  _resetScriptLoader,
} from "./razorpayService.js";

import { loadRazorpayScript } from "./razorpayService.js";
export default loadRazorpayScript;

