//
//  DateFormatting.swift
//  PlayoffChallenge
//
//  Centralized formatting for contest lock times.
//

import Foundation

/// Urgency level for a lock time (used to drive color in UI)
enum LockUrgency {
    case normal      // >6 hours until lock
    case warning     // 1-6 hours until lock
    case critical    // <1 hour until lock
}

/// Result of lock time formatting: string and urgency level
struct LockTimeDisplay {
    let text: String
    let urgency: LockUrgency
}

/// Formats lock_time for contest rows based on contest status.
/// Returns both the display string and urgency level for color coding.
/// - Parameters:
///   - lockTime: The lock time from the contest (optional)
///   - status: The contest status
/// - Returns: LockTimeDisplay with formatted string and urgency level, or nil if lock time should not be shown
func formatLockTimeForDisplay(lockTime: Date?, status: ContestStatus) -> LockTimeDisplay? {
    guard let lockTime = lockTime else { return nil }

    // Only show countdown for SCHEDULED contests
    guard status == .scheduled else { return nil }

    let now = Date()
    let calendar = Calendar.current
    let components = calendar.dateComponents([.day, .hour, .minute], from: now, to: lockTime)

    // If lock time is in the past, don't show
    guard let totalMinutes = components.minute, let totalHours = components.hour, let days = components.day,
          days > 0 || (days == 0 && totalHours > 0) || (days == 0 && totalHours == 0 && totalMinutes >= 0) else {
        return nil
    }

    // Compute urgency based on time remaining
    let totalMinutesRemaining = (days * 24 * 60) + (totalHours * 60) + totalMinutes
    let urgency: LockUrgency
    if totalMinutesRemaining < 60 {
        urgency = .critical   // <1 hour
    } else if totalMinutesRemaining < 360 {
        urgency = .warning    // 1-6 hours
    } else {
        urgency = .normal     // >6 hours
    }

    let isToday = calendar.isDateInToday(lockTime)
    let isTomorrow = calendar.isDateInTomorrow(lockTime)
    let isThisYear = calendar.component(.year, from: lockTime) == calendar.component(.year, from: now)

    // Format time of day (e.g., "8:00 PM")
    let timeFormatter = DateFormatter()
    timeFormatter.dateFormat = "h:mm a"
    let timeString = timeFormatter.string(from: lockTime)

    // Case 1: Lock time is today
    if isToday {
        return LockTimeDisplay(text: "Locks Today • \(timeString)", urgency: urgency)
    }

    // Case 2: Lock time is tomorrow
    if isTomorrow {
        return LockTimeDisplay(text: "Locks Tomorrow • \(timeString)", urgency: urgency)
    }

    // Case 3: Lock time is within 24 hours but not today (rare edge case during late night)
    if days == 0 && totalHours > 0 {
        let minuteString = String(format: "%02d", abs(totalMinutes))
        return LockTimeDisplay(text: "Locks in \(totalHours)h \(minuteString)m", urgency: urgency)
    }

    // Case 4: Lock time is multiple days away - show date
    let dateFormatter = DateFormatter()
    dateFormatter.dateFormat = isThisYear ? "MMM d" : "MMM d, yyyy"
    let dateString = dateFormatter.string(from: lockTime)

    return LockTimeDisplay(text: "Locks \(dateString) • \(timeString)", urgency: urgency)
}
