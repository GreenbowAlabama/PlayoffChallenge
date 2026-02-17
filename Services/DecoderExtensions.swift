import Foundation

extension JSONDecoder {
    /// Shared ISO8601 decoder that explicitly handles fractional seconds.
    /// This decoder works identically on simulator and device.
    /// Required because default .iso8601 does not support fractional seconds.
    static var iso8601Decoder: JSONDecoder {
        let decoder = JSONDecoder()

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds
        ]

        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)

            if let date = formatter.date(from: string) {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected ISO8601 with fractional seconds, got: \(string)"
            )
        }

        return decoder
    }
}
