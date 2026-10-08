from TTS.api import TTS
import os

MODEL = "tts_models/multilingual/multi-dataset/xtts_v2"
REFERENCE = "aria_final.wav"

print("Loading Aria...")

tts = TTS(MODEL)

print("Aria loaded!")


def speak(text, output_file="aria_response.wav"):
    print("Aria:", text)

    tts.tts_to_file(
        text=text,
        speaker_wav=REFERENCE,
        language="en",
        file_path=output_file
    )

    return output_file


if __name__ == "__main__":
    speak(
        "Hi, I'm Aria. How can I help you today?",
        "aria_response.wav"
    )

    print("Generated:", os.path.abspath("aria_response.wav"))