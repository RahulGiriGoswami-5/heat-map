/**
 * data.js
 * Data access module for SafePath.
 * Abstracts local storage persistence and handles privacy offsets and rate-limiting.
 * This can be swapped for a real API (like Supabase or custom REST endpoints) later.
 */

const REPORTS_KEY = 'safepath_reports';
const SUBMISSIONS_KEY = 'safepath_submissions';
const RATE_LIMIT_COUNT = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Applies a random offset of approximately 50-100 meters to the coordinates.
 * This is a pure utility function that handles the privacy offset calculations.
 * 1 degree of latitude is roughly 111,111 meters.
 * 1 degree of longitude is roughly 111,111 * cos(latitude) meters.
 * 
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {{lat: number, lng: number}} Offset coordinates
 */
export function applyRandomOffset(lat, lng) {
  const minOffsetMeters = 50;
  const maxOffsetMeters = 100;

  // Random distance between 50m and 100m
  const distance = minOffsetMeters + Math.random() * (maxOffsetMeters - minOffsetMeters);

  // Random angle in radians (0 to 2*pi)
  const angle = Math.random() * 2 * Math.PI;

  const latOffset = (distance * Math.cos(angle)) / 111111;
  const lngOffset = (distance * Math.sin(angle)) / (111111 * Math.cos(lat * Math.PI / 180));

  return {
    lat: lat + latOffset,
    lng: lng + lngOffset
  };
}

/**
 * Fetches all reported safety incidents from persistence.
 * Reports are returned sorted by created_at in descending order (newest first).
 * 
 * @returns {Array} Array of report objects
 */
export function getReports() {
  try {
    const rawData = localStorage.getItem(REPORTS_KEY);
    if (!rawData) return [];

    const reports = JSON.parse(rawData);
    // Ensure they are sorted by creation date descending
    return reports.sort((a, b) => b.created_at - a.created_at);
  } catch (error) {
    console.error('Error fetching reports from localStorage:', error);
    return [];
  }
}

/**
 * Adds a new report to persistence after applying privacy offsets.
 * Blocks submission if rate limits are exceeded.
 * 
 * @param {Object} reportInput - Object containing { lat, lng, category, note }
 * @returns {Object|null} The saved report object, or null if rate limited
 */
export function addReport(reportInput) {
  // 1. Perform rate limit check
  const rateLimitStatus = checkRateLimit();
  if (!rateLimitStatus.allowed) {
    console.warn('Submission blocked: Rate limit exceeded.');
    return null;
  }

  // 2. Apply privacy offset to coordinates
  const offsetCoords = applyRandomOffset(reportInput.lat, reportInput.lng);

  // 3. Construct report object
  const report = {
    id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9),
    lat: offsetCoords.lat,
    lng: offsetCoords.lng,
    category: reportInput.category,
    note: reportInput.note ? reportInput.note.substring(0, 100) : null, // Limit note to 100 chars
    created_at: Date.now()
  };

  // 4. Save to storage
  try {
    const reports = getReports();
    reports.push(report);
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));

    // 5. Record the submission for rate limiting
    recordSubmission();

    return report;
  } catch (error) {
    console.error('Error writing report to localStorage:', error);
    return null;
  }
}

/**
 * Clears all reports from localStorage.
 * Used for reset/debug demo purposes.
 */
export function clearReports() {
  try {
    localStorage.removeItem(REPORTS_KEY);
  } catch (error) {
    console.error('Error clearing reports from localStorage:', error);
  }
}

/**
 * Checks if the user is client-side rate limited (max 5 submissions per 10 minutes).
 * NOTE: In a production app, rate limiting MUST run on the server side
 * to prevent API abuse, as client-side checks can easily be bypassed.
 * 
 * @returns {{allowed: boolean, remaining: number, resetTime: number}} Rate limit status details
 */
export function checkRateLimit() {
  try {
    const rawSubmissions = localStorage.getItem(SUBMISSIONS_KEY);
    const now = Date.now();

    if (!rawSubmissions) {
      return { allowed: true, remaining: RATE_LIMIT_COUNT, resetTime: 0 };
    }

    let submissions = JSON.parse(rawSubmissions);

    // Filter out submissions older than the 10-minute window
    submissions = submissions.filter(timestamp => (now - timestamp) < RATE_LIMIT_WINDOW_MS);

    // Update local storage to only keep relevant timestamps
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(submissions));

    if (submissions.length >= RATE_LIMIT_COUNT) {
      // Find when the oldest submission in the window expires
      const oldestSub = Math.min(...submissions);
      const resetTime = oldestSub + RATE_LIMIT_WINDOW_MS;
      return {
        allowed: false,
        remaining: 0,
        resetTime
      };
    }

    return {
      allowed: true,
      remaining: RATE_LIMIT_COUNT - submissions.length,
      resetTime: 0
    };
  } catch (error) {
    console.error('Error checking rate limit:', error);
    // Fail-open for UI robustness, but log the error
    return { allowed: true, remaining: 1, resetTime: 0 };
  }
}

/**
 * Records a new submission timestamp in localStorage.
 */
function recordSubmission() {
  try {
    const rawSubmissions = localStorage.getItem(SUBMISSIONS_KEY) || '[]';
    const submissions = JSON.parse(rawSubmissions);
    submissions.push(Date.now());
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(submissions));
  } catch (error) {
    console.error('Error recording submission timestamp:', error);
  }
}

/**
 * Dev utility: Resets the submission history/rate limits.
 */
export function resetRateLimits() {
  try {
    localStorage.removeItem(SUBMISSIONS_KEY);
  } catch (error) {
    console.error('Error resetting rate limits:', error);
  }
}

/**
 * Dev utility: Imports reports directly to local storage (bypassing rate limit and offset rules).
 * Useful for seeding demo data.
 * 
 * @param {Array} newReports - List of reports to load
 */
export function importReports(newReports) {
  try {
    const reports = getReports();
    // Merge new reports
    const merged = [...reports, ...newReports];
    localStorage.setItem(REPORTS_KEY, JSON.stringify(merged));
  } catch (error) {
    console.error('Error importing reports:', error);
  }
}

