import PhotosUI
import SwiftUI
import UIKit

// Image helpers shared by the receipt scanner (Expenses) and the Chat composer.

enum MediaImage {
    /// Server-bound images: max 1600px long edge, JPEG ~0.7.
    static let maxDimension: CGFloat = 1600
    static let jpegQuality: CGFloat = 0.7

    struct Prepared {
        let image: UIImage   // downscaled, orientation-normalised
        let jpeg: Data

        var base64: String { jpeg.base64EncodedString() }
        var dataURL: String { "data:image/jpeg;base64," + base64 }
    }

    /// Downscales + JPEG-encodes off the main thread.
    static func prepare(_ image: UIImage) async -> Prepared? {
        await Task.detached(priority: .userInitiated) {
            let scaled = downscaled(image, maxDimension: maxDimension)
            guard let data = scaled.jpegData(compressionQuality: jpegQuality) else { return nil }
            return Prepared(image: scaled, jpeg: data)
        }.value
    }

    /// Loads a PhotosPicker item as a UIImage.
    static func load(_ item: PhotosPickerItem) async -> UIImage? {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return nil }
        return UIImage(data: data)
    }

    /// Redraws at most `maxDimension` on the long edge with scale 1 (also bakes in EXIF orientation).
    static func downscaled(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let size = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let longest = max(size.width, size.height)
        let ratio = longest > maxDimension ? maxDimension / longest : 1
        let target = CGSize(width: max(1, (size.width * ratio).rounded()), height: max(1, (size.height * ratio).rounded()))
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }
}

/// `UIImagePickerController` camera wrapper. Check `MediaCameraPicker.isAvailable` first (no camera on the simulator).
struct MediaCameraPicker: UIViewControllerRepresentable {
    static var isAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    var onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: MediaCameraPicker
        init(_ parent: MediaCameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
