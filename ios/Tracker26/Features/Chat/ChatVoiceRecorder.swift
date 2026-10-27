import AVFoundation
import Foundation
import Observation

/// Hold-to-talk recorder: AAC .m4a, 44.1 kHz mono, written to a temp file.
@MainActor
@Observable
final class ChatVoiceRecorder {
    enum Permission { case granted, denied, undetermined }

    enum StartResult { case started, needsPermission, denied, failed(String) }

    private(set) var isRecording = false
    private(set) var startedAt: Date?

    private var recorder: AVAudioRecorder?
    private var fileURL: URL?

    var permission: Permission {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: .granted
        case .denied: .denied
        default: .undetermined
        }
    }

    func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    func start() -> StartResult {
        switch permission {
        case .undetermined: return .needsPermission
        case .denied: return .denied
        case .granted: break
        }
        guard !isRecording else { return .started }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)

            let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            guard recorder.record() else {
                deactivate()
                return .failed("Couldn't start recording")
            }
            self.recorder = recorder
            fileURL = url
            isRecording = true
            startedAt = Date()
            return .started
        } catch {
            deactivate()
            return .failed(error.localizedDescription)
        }
    }

    /// Stops and returns the audio (nil if too short / failed). Cleans up the temp file.
    func stop() -> (data: Data, duration: TimeInterval)? {
        guard let recorder else { return nil }
        let duration = recorder.currentTime
        recorder.stop()
        self.recorder = nil
        isRecording = false
        startedAt = nil
        deactivate()

        defer {
            if let fileURL { try? FileManager.default.removeItem(at: fileURL) }
            fileURL = nil
        }
        guard let fileURL, let data = try? Data(contentsOf: fileURL), data.count > 1_000 else { return nil }
        return (data, duration)
    }

    /// Stops and throws the recording away.
    func cancel() {
        _ = stop()
    }

    private func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
