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
        let controller = UIViewController()

        var configuration = PaymentSheet.Configuration()
        configuration.merchantDisplayName = merchantDisplayName
        configuration.allowsDelayedPaymentMethods = false

        let paymentSheet = PaymentSheet(
            paymentIntentClientSecret: clientSecret,
            configuration: configuration
        )

        DispatchQueue.main.async {
            onPresented()
            paymentSheet.present(from: controller) { result in
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
        }

        return controller
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
    }
}
