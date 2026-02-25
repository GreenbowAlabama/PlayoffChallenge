import Foundation

/// A single line in a payout preview table.
public struct PayoutLineData: Equatable {
    public let place: String       // e.g., "1st", "2nd"
    public let percentage: Double  // e.g., 50.0 (out of 100)
    public let amount: Double?     // dollars (not cents)

    public init(place: String, percentage: Double, amount: Double?) {
        self.place = place
        self.percentage = percentage
        self.amount = amount
    }
}

/// Payout structure metadata for calculations.
public struct PayoutStructureData: Equatable {
    public let type: String
    public let maxWinners: Int?

    public init(type: String, maxWinners: Int? = nil) {
        self.type = type
        self.maxWinners = maxWinners
    }
}
