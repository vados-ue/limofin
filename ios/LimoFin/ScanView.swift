import SwiftUI
import PhotosUI
import VisionKit

struct ScanView: View {
    @EnvironmentObject var state: AppState
    @State private var showDocScanner = false
    @State private var photoItem: PhotosPickerItem?
    @State private var uploading = false
    @State private var review: ReviewContext?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    scanButtons
                    Text(state.reachable
                         ? "Parsed by AI, you confirm before anything is logged."
                         : "Offline — receipts queue and sync on home Wi-Fi.")
                        .font(.caption)
                        .foregroundStyle(Theme.muted)

                    if !state.queue.isEmpty {
                        SectionLabel(text: "Queued (\(state.queue.count))")
                        Card(padding: 0) {
                            VStack(spacing: 0) {
                                ForEach(state.queue) { item in
                                    queueRow(item)
                                    if item.id != state.queue.last?.id {
                                        Divider().overlay(Color.white.opacity(0.08))
                                    }
                                }
                            }
                        }
                    }

                    if !state.recent.isEmpty {
                        SectionLabel(text: "Recent")
                        Card(padding: 0) {
                            VStack(spacing: 0) {
                                ForEach(state.recent) { receipt in
                                    recentRow(receipt)
                                    if receipt.id != state.recent.last?.id {
                                        Divider().overlay(Color.white.opacity(0.08))
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 24)
            }
            .background(Theme.bg)
            .navigationTitle("Scan")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                await state.refreshRecent()
                _ = await API.health()
            }
            .overlay {
                if uploading {
                    ZStack {
                        Color.black.opacity(0.5).ignoresSafeArea()
                        ProgressView("Uploading…").tint(Theme.green)
                    }
                }
            }
            .sheet(isPresented: $showDocScanner) {
                DocScannerView { image in
                    showDocScanner = false
                    if let image { Task { await handleImage(image) } }
                }
                .ignoresSafeArea()
            }
            .sheet(item: $review) { context in
                ReceiptConfirmSheet(context: context) {
                    review = nil
                    Task {
                        await state.refreshToday()
                        await state.refreshRecent()
                        state.reloadQueue()
                    }
                }
                .presentationDetents([.large])
            }
            .alert("Receipt", isPresented: .init(get: { errorMessage != nil }, set: { _ in errorMessage = nil })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                photoItem = nil
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self),
                       let image = UIImage(data: data) {
                        await handleImage(image)
                    }
                }
            }
        }
    }

    private var scanButtons: some View {
        VStack(spacing: 8) {
            Button {
                if DocScannerView.isSupported {
                    showDocScanner = true
                }
            } label: {
                VStack(spacing: 8) {
                    Image(systemName: "doc.viewfinder")
                        .font(.system(size: 34, weight: .semibold))
                    Text(DocScannerView.isSupported ? "Scan a receipt" : "Camera unavailable")
                        .font(.system(size: 16, weight: .bold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 26)
                .background(
                    LinearGradient(colors: [Theme.green.opacity(0.16), Theme.blue.opacity(0.10)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                )
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(Theme.green.opacity(0.55), style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
                )
            }
            .buttonStyle(.plain)
            .disabled(!DocScannerView.isSupported)

            PhotosPicker(selection: $photoItem, matching: .images) {
                Label("Choose from photos", systemImage: "photo.on.rectangle")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Theme.surfaceAlt)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }

    private func handleImage(_ image: UIImage) async {
        guard let jpeg = receiptJPEG(from: image) else {
            errorMessage = "Couldn't process that photo."
            return
        }
        let reachable = await API.health()
        guard reachable else {
            _ = OfflineQueue.add(jpeg: jpeg)
            state.reloadQueue()
            errorMessage = "Offline — receipt queued. It'll upload on home Wi-Fi."
            return
        }
        uploading = true
        defer { uploading = false }
        do {
            let result = try await API.uploadReceipt(jpeg: jpeg)
            review = ReviewContext(upload: result, thumb: UIImage(data: jpeg), queued: nil,
                                   envelopes: state.today?.envelopes ?? [])
        } catch {
            _ = OfflineQueue.add(jpeg: jpeg)
            state.reloadQueue()
            errorMessage = "Upload failed (\(error.localizedDescription)) — queued instead."
        }
    }

    private func queueRow(_ item: QueuedReceipt) -> some View {
        HStack(spacing: 10) {
            if let image = OfflineQueue.image(for: item) {
                Image(uiImage: image)
                    .resizable().scaledToFill()
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Waiting for Wi-Fi").font(.system(size: 14, weight: .semibold))
                Text(item.createdAt.formatted(.relative(presentation: .named)))
                    .font(.system(size: 11)).foregroundStyle(Theme.muted)
            }
            Spacer()
            Button("Sync") {
                Task {
                    guard await API.health(), let jpeg = OfflineQueue.jpeg(for: item) else {
                        errorMessage = "Still offline."
                        return
                    }
                    uploading = true
                    defer { uploading = false }
                    do {
                        let result = try await API.uploadReceipt(jpeg: jpeg)
                        review = ReviewContext(upload: result, thumb: OfflineQueue.image(for: item),
                                               queued: item, envelopes: state.today?.envelopes ?? [])
                    } catch {
                        errorMessage = error.localizedDescription
                    }
                }
            }
            .font(.system(size: 13, weight: .bold))
            .buttonStyle(.bordered)
            .tint(Theme.green)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    private func recentRow(_ receipt: Receipt) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(receipt.merchant ?? "Receipt").font(.system(size: 14, weight: .semibold))
                Text(receipt.purchaseDate ?? String((receipt.createdAt ?? "").prefix(10)))
                    .font(.system(size: 11)).foregroundStyle(Theme.muted)
            }
            Spacer()
            Text(money(receipt.totalCents)).font(.system(size: 14, weight: .bold))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }
}

// MARK: - Confirm sheet

struct ReviewContext: Identifiable {
    let id = UUID()
    let upload: ReceiptUploadResponse
    let thumb: UIImage?
    let queued: QueuedReceipt?
    let envelopes: [Envelope]
}

struct ReceiptConfirmSheet: View {
    let context: ReviewContext
    let onDone: () -> Void

    @State private var amount: String = ""
    @State private var date = Date()
    @State private var envelopeId: Int?
    @State private var category: String = ""
    @State private var memo: String = ""
    @State private var busy = false
    @State private var errorMessage: String?

    private var aiLabel: String {
        switch context.upload.ai {
        case "ok":
            if let confidence = context.upload.parsed?.confidence {
                return "AI parsed · \(Int(confidence * 100))%"
            }
            return "AI parsed"
        case "unconfigured": return "AI off — manual entry"
        default: return "AI failed — manual entry"
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        if let thumb = context.thumb {
                            Image(uiImage: thumb)
                                .resizable().scaledToFill()
                                .frame(width: 64, height: 64)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text(context.upload.parsed?.merchant ?? "Receipt")
                                .font(.headline)
                            Text(aiLabel)
                                .font(.caption2.bold())
                                .foregroundStyle(context.upload.ai == "ok" ? Theme.green : Theme.yellow)
                        }
                    }
                }
                Section("Details") {
                    HStack {
                        Text("$").foregroundStyle(Theme.muted)
                        TextField("0.00", text: $amount)
                            .keyboardType(.decimalPad)
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    Picker("Envelope", selection: $envelopeId) {
                        Text("Ledger only").tag(Int?.none)
                        ForEach(context.envelopes) { envelope in
                            Text("\(envelope.name) · \(money(envelope.remainingCents)) left")
                                .tag(Int?.some(envelope.id))
                        }
                    }
                    Picker("Category", selection: $category) {
                        Text("None").tag("")
                        ForEach(expenseCategories, id: \.self) { Text($0).tag($0) }
                    }
                    TextField("Memo", text: $memo)
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Theme.red) }
                }
            }
            .navigationTitle("Confirm receipt")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Dismiss", role: .destructive) {
                        Task {
                            try? await API.dismissReceipt(id: context.upload.receipt.id)
                            if let queued = context.queued { OfflineQueue.remove(queued) }
                            onDone()
                        }
                    }
                    .tint(Theme.red)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Logging…" : "Log it") { Task { await commit() } }
                        .disabled(busy)
                        .bold()
                }
            }
            .onAppear {
                let parsed = context.upload.parsed
                if let cents = parsed?.totalCents { amount = String(format: "%.2f", Double(cents) / 100) }
                memo = parsed?.merchant ?? ""
                category = parsed?.category ?? ""
                if let name = parsed?.envelope {
                    envelopeId = context.envelopes.first { $0.name.caseInsensitiveCompare(name) == .orderedSame }?.id
                }
                if let dateString = parsed?.date {
                    let formatter = DateFormatter()
                    formatter.locale = Locale(identifier: "en_US_POSIX")
                    formatter.dateFormat = "yyyy-MM-dd"
                    if let parsedDate = formatter.date(from: dateString) { date = parsedDate }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func commit() async {
        let cleaned = amount.replacingOccurrences(of: "$", with: "").replacingOccurrences(of: ",", with: "")
        guard let value = Double(cleaned), value > 0 else {
            errorMessage = "Enter a valid amount."
            return
        }
        busy = true
        defer { busy = false }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        do {
            _ = try await API.commitReceipt(
                id: context.upload.receipt.id,
                amountCents: Int((value * 100).rounded()),
                date: formatter.string(from: date),
                envelopeId: envelopeId,
                memo: memo.isEmpty ? nil : memo,
                category: category.isEmpty ? nil : category
            )
            if let queued = context.queued { OfflineQueue.remove(queued) }
            onDone()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - VisionKit document scanner

struct DocScannerView: UIViewControllerRepresentable {
    static var isSupported: Bool { VNDocumentCameraViewController.isSupported }

    let completion: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let completion: (UIImage?) -> Void
        init(completion: @escaping (UIImage?) -> Void) { self.completion = completion }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            completion(scan.pageCount > 0 ? scan.imageOfPage(at: 0) : nil)
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            completion(nil)
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            completion(nil)
        }
    }
}
