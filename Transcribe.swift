import Foundation
import Speech
import AVFoundation
@main struct Transcribe {
 static func emit(_ value:[String:Any]) { if let data=try? JSONSerialization.data(withJSONObject:value),let s=String(data:data,encoding:.utf8){print(s);fflush(stdout)} }
 static func main() async {
  do {
   guard SpeechTranscriber.isAvailable else {throw NSError(domain:"SpeechGates",code:1,userInfo:[NSLocalizedDescriptionKey:"Apple SpeechTranscriber is unavailable on this Mac."])}
   guard let locale=await SpeechTranscriber.supportedLocale(equivalentTo:Locale(identifier:"en-US")) else {throw NSError(domain:"SpeechGates",code:2,userInfo:[NSLocalizedDescriptionKey:"English transcription is unavailable."])}
   let transcriber=SpeechTranscriber(locale:locale,preset:.transcription)
   if let install=try await AssetInventory.assetInstallationRequest(supporting:[transcriber]) {
    emit(["status":"Installing Apple's on-device speech model."])
    try await install.downloadAndInstall()
   }
   if CommandLine.arguments.count<2 || CommandLine.arguments[1]=="--prepare" {emit(["status":"Apple on-device transcription is ready."]);return}
   let file=try AVAudioFile(forReading:URL(fileURLWithPath:CommandLine.arguments[1]))
   let analyzer=SpeechAnalyzer(modules:[transcriber])
   let results=Task {
    for try await result in transcriber.results {
     emit(["text":String(result.text.characters),"start":result.range.start.seconds,"end":result.range.end.seconds])
    }
   }
   try await analyzer.start(inputAudioFile:file,finishAfterFile:true)
   try await results.value
  } catch {emit(["error":error.localizedDescription]);exit(1)}
 }
}
