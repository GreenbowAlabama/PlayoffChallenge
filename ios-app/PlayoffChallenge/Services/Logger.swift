import Foundation

/// Signal-only logging system for production code.
/// Anomalies only: contract violations, unexpected states, mode switches.
/// NO: payloads, counts, success messages, flow logging.
enum Log {
    case error(String)
    case info(String, scope: String)

    func emit() {
        switch self {
        case .error(let message):
            print(message)
        case .info(let message, let scope):
            print("[\(scope)] \(message)")
        }
    }
}

extension Log {
    static func error(_ message: String) {
        Log.error(message).emit()
    }

    static func info(_ message: String, scope: String) {
        Log.info(message, scope: scope).emit()
    }
}
