//
//  PaymentSheetPresenter.swift
//  PlayoffChallenge
//
//  Direct Stripe PaymentSheet presentation (not in SwiftUI sheet hierarchy).
//  Presents PaymentSheet directly from root view controller when ready.
//

import SwiftUI
import StripePaymentSheet

struct PaymentSheetPresenter: ViewModifier {
    @ObservedObject var viewModel: UserWalletViewModel

    func body(content: Content) -> some View {
        content
            .onChange(of: viewModel.paymentState) { _, newState in
                print("[PaymentSheetPresenter] State changed to: \(newState)")
                switch newState {
                case .ready(let clientSecret):
                    print("[PaymentSheetPresenter] Ready to present PaymentSheet directly")
                    presentPaymentSheetDirectly(clientSecret: clientSecret)
                case .idle:
                    print("[PaymentSheetPresenter] Reset to idle")
                case .success:
                    print("[PaymentSheetPresenter] Payment successful")
                case .failure:
                    print("[PaymentSheetPresenter] Payment failed")
                case .creatingIntent, .processing:
                    break
                }
            }
    }

    private func presentPaymentSheetDirectly(clientSecret: String) {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let rootVC = windowScene.windows.first?.rootViewController else {
            print("[PaymentSheetPresenter] ERROR: Cannot find root view controller")
            return
        }

        print("[PaymentSheetPresenter] DEBUG: Found rootVC: \(type(of: rootVC))")

        // Find the topmost presented view controller
        var topVC = rootVC
        while let presented = topVC.presentedViewController {
            print("[PaymentSheetPresenter] DEBUG: Found presented VC: \(type(of: presented))")
            topVC = presented
        }

        print("[PaymentSheetPresenter] DEBUG: Will present from topmost VC: \(type(of: topVC))")

        var configuration = PaymentSheet.Configuration()
        configuration.merchantDisplayName = "Playoff Challenge"
        configuration.allowsDelayedPaymentMethods = false

        let paymentSheet = PaymentSheet(
            paymentIntentClientSecret: clientSecret,
            configuration: configuration
        )

        print("[PaymentSheetPresenter] DEBUG: Created PaymentSheet, calling present()")

        paymentSheet.present(from: topVC) { result in
            print("[PaymentSheetPresenter] PaymentSheet result: \(result)")

            DispatchQueue.main.async {
                switch result {
                case .completed:
                    print("[PaymentSheetPresenter] Payment completed")
                    Task { await viewModel.onPaymentCompleted() }
                case .canceled:
                    print("[PaymentSheetPresenter] Payment cancelled by user")
                    Task { @MainActor in viewModel.onPaymentCancelled() }
                case .failed(let error):
                    print("[PaymentSheetPresenter] Payment failed: \(error.localizedDescription)")
                    Task { @MainActor in viewModel.onPaymentFailed(error: error.localizedDescription) }
                }
                viewModel.dismissPaymentSheet()
            }
        }
    }
}

extension View {
    func withPaymentSheet(viewModel: UserWalletViewModel) -> some View {
        modifier(PaymentSheetPresenter(viewModel: viewModel))
    }
}
