//
//  DateFormatting.swift
//  PlayoffChallenge
//
//  Centralized formatting for contest lock times.
//

import Foundation

// MARK: - Shared Formatters (avoid allocation in rendering code)

private let timeFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "h:mm a"
    return f
}()

private let dateFormatterCurrentYear: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "MMM d"
    return f
}()

private let dateFormatterOtherYear: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "MMM d, yyyy"
    return f
}()

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
///   - status: The contest status enum
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
    let dateFormatter = isThisYear ? dateFormatterCurrentYear : dateFormatterOtherYear
    let dateString = dateFormatter.string(from: lockTime)

    return LockTimeDisplay(text: "Locks \(dateString) • \(timeString)", urgency: urgency)
}

/// Formats start_time for display on contest cards.
/// Returns a human-readable string like "Starts Today • 8:00 AM" or "Starts Apr 10 • 8:00 AM".
/// - Parameter startTime: The start time from the contest (optional)
/// - Returns: Formatted display string, or nil if start time should not be shown
func formatStartTimeForDisplay(_ startTime: Date?) -> String? {
    guard let startTime = startTime else { return nil }

    let now = Date()
    let calendar = Calendar.current

    let isToday = calendar.isDateInToday(startTime)
    let isTomorrow = calendar.isDateInTomorrow(startTime)
    let isThisYear = calendar.component(.year, from: startTime) == calendar.component(.year, from: now)

    let timeString = timeFormatter.string(from: startTime)

    // Case 1: Start time is today
    if isToday {
        return "Starts Today • \(timeString)"
    }

    // Case 2: Start time is tomorrow
    if isTomorrow {
        return "Starts Tomorrow • \(timeString)"
    }

    // Case 3: Start time is in the future - show date
    let dateFormatter = isThisYear ? dateFormatterCurrentYear : dateFormatterOtherYear
    let dateString = dateFormatter.string(from: startTime)

    return "Starts \(dateString) • \(timeString)"
}

/// Formats countdown time until lock in compact format like "Locks in 21h 49m".
/// Shows only hours if >= 1 hour, or only minutes if < 1 hour.
/// - Parameter lockTime: The lock time to count down to (optional)
/// - Returns: Formatted countdown string like "Locks in 5h 30m" or "Locks in 30m", or nil if time has passed
func formatLockCountdown(_ lockTime: Date?) -> String? {
    guard let lockTime = lockTime else { return nil }

    let now = Date()
    let interval = lockTime.timeIntervalSince(now)

    // If time has passed, return nil
    guard interval > 0 else { return nil }

    let seconds = Int(interval)
    let hours = seconds / 3600
    let minutes = (seconds % 3600) / 60

    if hours > 0 {
        return "Locks in \(hours)h \(minutes)m"
    } else {
        return "Locks in \(minutes)m"
    }
}

/// Formats contest event start time with priority logic (tournament_start_time > start_time > lock_time).
/// Returns a human-readable string like "Starts Today • 8:00 AM".
/// - Parameters:
///   - tournamentStartTime: The tournament start time from the contest (highest priority)
///   - startTime: The start time from the contest (fallback)
///   - lockTime: The lock time from the contest (final fallback)
/// - Returns: Formatted display string, or nil if no time is available
func formatContestEventStartTime(
    tournamentStartTime: Date?,
    startTime: Date?,
    lockTime: Date?
) -> String? {
    // Apply priority logic: tournamentStartTime > startTime > lockTime
    let displayTime = tournamentStartTime ?? startTime ?? lockTime
    return formatStartTimeForDisplay(displayTime)
}
