//
//  StripePaymentSheetController.swift
//  PlayoffChallenge
//
//  Single Stripe integration surface.
//  UIViewControllerRepresentable for PaymentSheet presentation.
//  Stripe SDK confined to this file only.
//

import SwiftUI
import StripePaymentSheet

enum WalletPaymentResult: Equatable {
    case completed
    case cancelled
    case failed(message: String)
}

struct StripePaymentSheetController: UIViewControllerRepresentable {
    let clientSecret: String
    let merchantDisplayName: String
    let onPresented: () -> Void
    let onResult: (WalletPaymentResult) -> Void

    func makeUIViewController(context: Context) -> UIViewController {
        print("[StripePaymentSheetController] ⚠️ makeUIViewController called!")
        let controller = UIViewController()

        var configuration = PaymentSheet.Configuration()
        configuration.merchantDisplayName = merchantDisplayName
        configuration.allowsDelayedPaymentMethods = false

        let paymentSheet = PaymentSheet(
            paymentIntentClientSecret: clientSecret,
            configuration: configuration
        )

        DispatchQueue.main.async {
            print("[StripePaymentSheetController] DEBUG: Entering async block")
            print("[StripePaymentSheetController] DEBUG: connectedScenes count: \(UIApplication.shared.connectedScenes.count)")

            guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene else {
                print("[StripePaymentSheetController] ERROR: No UIWindowScene found")
                return
            }

            print("[StripePaymentSheetController] DEBUG: windowScene found: \(windowScene)")
            print("[StripePaymentSheetController] DEBUG: windows count: \(windowScene.windows.count)")

            guard let rootVC = windowScene.windows.first?.rootViewController else {
                print("[StripePaymentSheetController] ERROR: Unable to find root view controller")
                print("[StripePaymentSheetController] DEBUG: first window: \(String(describing: windowScene.windows.first))")
                return
            }

            print("[StripePaymentSheetController] DEBUG: rootVC found: \(type(of: rootVC))")
            onPresented()
            print("[StripePaymentSheetController] DEBUG: Calling paymentSheet.present(from:)")

            do {
                paymentSheet.present(from: rootVC) { result in
                    DispatchQueue.main.async {
                        switch result {
                        case .completed:
                            print("[StripePaymentSheetController] Payment completed")
                            onResult(.completed)
                        case .canceled:
                            print("[StripePaymentSheetController] Payment cancelled by user")
                            onResult(.cancelled)
                        case .failed(let error):
                            print("[StripePaymentSheetController] Payment failed: \(error.localizedDescription)")
                            onResult(.failed(message: error.localizedDescription))
                        }
                    }
                }
                print("[StripePaymentSheetController] DEBUG: paymentSheet.present() called")
            } catch {
                print("[StripePaymentSheetController] ERROR: Exception during present: \(error)")
            }
        }

        return controller
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
    }
}
