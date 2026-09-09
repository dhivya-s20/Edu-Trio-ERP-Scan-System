import { useEffect, useRef, useState } from "react";
import { createWorker } from "tesseract.js";
import { createClient } from "@supabase/supabase-js";
import "./App.css";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);

type ExtractedStudent = {
  studentName: string;
  registerNumber: string;
  dateOfBirth: string;
};

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");

  const [capturedPreview, setCapturedPreview] = useState("");

  const [ocrLoading, setOcrLoading] = useState(false);

  const [status, setStatus] = useState("");
  const [success, setSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // =====================================================
  // RESET
  // =====================================================

  const resetAll = () => {
    setStatus("");
    setSuccess(false);
    setOcrLoading(false);
  };

  // =====================================================
  // FILE UPLOAD
  // =====================================================

  const handleFile = (selectedFile?: File) => {
    if (!selectedFile) return;

    if (!selectedFile.type.startsWith("image/")) {
      alert(
        "Please upload a JPG or PNG certificate."
      );
      return;
    }

    setFile(selectedFile);
    resetAll();

    const imageUrl =
      URL.createObjectURL(selectedFile);

    setPreview(imageUrl);
  };

  // =====================================================
  // CAMERA
  // =====================================================

  const openCamera = async () => {
    setCameraError("");
    setCameraOpen(true);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Camera is not supported."
        );
      }

      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: {
              ideal: "environment",
            },
          },
          audio: false,
        });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        await videoRef.current.play();
      }
    } catch (error) {
      console.error(error);

      setCameraError(
        "Camera access failed. Please allow camera permission."
      );
    }
  };

  // =====================================================
  // STOP CAMERA
  // =====================================================

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current
        .getTracks()
        .forEach((track) => track.stop());

      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // =====================================================
  // CLOSE CAMERA
  // =====================================================

  const closeCamera = () => {
    stopCamera();

    setCameraOpen(false);
    setCameraError("");
  };

  // =====================================================
  // CAPTURE
  // =====================================================

  const capturePhoto = () => {
    const video = videoRef.current;

    if (!video) {
      alert("Camera is not ready.");
      return;
    }

    if (
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      alert(
        "Please wait for the camera to start."
      );
      return;
    }

    const canvas =
      document.createElement("canvas");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx =
      canvas.getContext("2d");

    if (!ctx) {
      alert("Unable to capture image.");
      return;
    }

    ctx.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          alert("Capture failed.");
          return;
        }

        const capturedFile = new File(
          [blob],
          "certificate-scan.jpg",
          {
            type: "image/jpeg",
          }
        );

        const imageUrl =
          URL.createObjectURL(blob);

        setFile(capturedFile);
        setPreview(imageUrl);
        setCapturedPreview(imageUrl);

        resetAll();

        stopCamera();
        setCameraOpen(false);
      },
      "image/jpeg",
      0.98
    );
  };

  // =====================================================
  // RETAKE
  // =====================================================

  const retakePhoto = async () => {
    setFile(null);
    setPreview("");
    setCapturedPreview("");

    resetAll();

    await openCamera();
  };

  // =====================================================
  // REMOVE
  // =====================================================

  const removeFile = () => {
    setFile(null);
    setPreview("");
    setCapturedPreview("");

    resetAll();

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // =====================================================
  // IMAGE PREPROCESSING
  // =====================================================

  const preprocessImage = async (
    imageFile: File
  ): Promise<HTMLCanvasElement> => {
    const image =
      new Image();

    const imageUrl =
      URL.createObjectURL(imageFile);

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(
          new Error(
            "Unable to load certificate image."
          )
        );

      image.src = imageUrl;
    });

    const canvas =
      document.createElement("canvas");

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const ctx =
      canvas.getContext("2d");

    if (!ctx) {
      URL.revokeObjectURL(imageUrl);

      throw new Error(
        "Canvas is not supported."
      );
    }

    ctx.drawImage(
      image,
      0,
      0,
      canvas.width,
      canvas.height
    );

    URL.revokeObjectURL(imageUrl);

    return canvas;
  };

  // =====================================================
  // CROP REGION
  // =====================================================

  const cropRegion = (
    source: HTMLCanvasElement,
    x: number,
    y: number,
    width: number,
    height: number
  ) => {
    const crop =
      document.createElement("canvas");

    crop.width = width;
    crop.height = height;

    const ctx =
      crop.getContext("2d");

    if (!ctx) return crop;

    ctx.drawImage(
      source,
      x,
      y,
      width,
      height,
      0,
      0,
      width,
      height
    );

    return crop;
  };

  // =====================================================
  // OCR SINGLE REGION
  // =====================================================

  const readRegion = async (
    worker: any,
    canvas: HTMLCanvasElement
  ) => {
    const result =
      await worker.recognize(canvas);

    return result.data.text
      .replace(/\r/g, " ")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  // =====================================================
  // NAME CLEANING
  // =====================================================

  const cleanStudentName = (
    text: string
  ) => {
    let value = text
      .replace(
        /NAME OF THE CANDIDATE/gi,
        ""
      )
      .replace(
        /DATE OF BIRTH/gi,
        ""
      )
      .replace(
        /PERMANENT REGISTER NUMBER/gi,
        ""
      )
      .replace(
        /[^A-Za-z .]/g,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();

    /*
      This certificate contains:
      DHIVYA S
    */

    const words = value
      .split(" ")
      .filter(Boolean);

    if (words.length > 0) {
      value = words
        .slice(0, 5)
        .join(" ");
    }

    return value;
  };

  // =====================================================
  // REGISTER NUMBER
  // =====================================================

  const extractRegisterNumber = (
    text: string
  ) => {
    /*
      Tamil Nadu HSE Permanent Register Number
      Example:
      2313317580
    */

    const matches =
      text.match(/\b\d{10}\b/g);

    if (matches?.length) {
      return matches[0];
    }

    const cleaned =
      text.replace(
        /[^0-9]/g,
        ""
      );

    if (cleaned.length >= 10) {
      return cleaned.substring(
        0,
        10
      );
    }

    return "";
  };

  // =====================================================
  // DOB
  // =====================================================

  const extractDOB = (
    text: string
  ) => {
    const match =
      text.match(
        /\b(0?[1-9]|[12][0-9]|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](19|20)\d{2}\b/
      );

    if (match) {
      return match[0]
        .replace(/\./g, "/")
        .replace(/-/g, "/");
    }

    return "";
  };

  // =====================================================
  // DATE TO SUPABASE FORMAT
  // =====================================================

  const convertDateToISO = (
    value: string
  ) => {
    if (!value) return null;

    const parts =
      value.split("/");

    if (parts.length !== 3) {
      return null;
    }

    let day = parts[0];
    let month = parts[1];
    let year = parts[2];

    if (day.length === 1) {
      day = `0${day}`;
    }

    if (month.length === 1) {
      month = `0${month}`;
    }

    if (year.length === 2) {
      year =
        Number(year) >= 50
          ? `19${year}`
          : `20${year}`;
    }

    return `${year}-${month}-${day}`;
  };

  // =====================================================
  // EXTRACT FROM THIS CERTIFICATE TEMPLATE
  // =====================================================

  const extractStudentDetails =
    async (
      imageFile: File
    ): Promise<ExtractedStudent> => {

      const source =
        await preprocessImage(
          imageFile
        );

      const worker =
        await createWorker("eng");

      try {
        /*
        ==================================================
        IMPORTANT

        This certificate has a fixed layout.

        We read the following regions:

        NAME:
        Around candidate name area

        DOB:
        Around date of birth area

        REGISTER:
        Around permanent register number area
        ==================================================
        */

        const W =
          source.width;

        const H =
          source.height;

        // ---------------------------------------------
        // NAME REGION
        // ---------------------------------------------

        const nameCrop =
          cropRegion(
            source,

            Math.floor(W * 0.07),
            Math.floor(H * 0.225),

            Math.floor(W * 0.25),
            Math.floor(H * 0.065)
          );

        // ---------------------------------------------
        // DOB REGION
        // ---------------------------------------------

        const dobCrop =
          cropRegion(
            source,

            Math.floor(W * 0.07),
            Math.floor(H * 0.255),

            Math.floor(W * 0.25),
            Math.floor(H * 0.055)
          );

        // ---------------------------------------------
        // REGISTER REGION
        // ---------------------------------------------

        const registerCrop =
          cropRegion(
            source,

            Math.floor(W * 0.28),
            Math.floor(H * 0.255),

            Math.floor(W * 0.37),
            Math.floor(H * 0.055)
          );

        const nameText =
          await readRegion(
            worker,
            nameCrop
          );

        const dobText =
          await readRegion(
            worker,
            dobCrop
          );

        const registerText =
          await readRegion(
            worker,
            registerCrop
          );

        console.log(
          "NAME OCR:",
          nameText
        );

        console.log(
          "DOB OCR:",
          dobText
        );

        console.log(
          "REGISTER OCR:",
          registerText
        );

        const studentName =
          cleanStudentName(
            nameText
          );

        const dateOfBirth =
          extractDOB(
            dobText
          );

        const registerNumber =
          extractRegisterNumber(
            registerText
          );

        return {
          studentName,
          registerNumber,
          dateOfBirth,
        };

      } finally {
        await worker.terminate();
      }
    };

  // =====================================================
  // SUPABASE SAVE
  // =====================================================

  const saveStudent =
    async (
      student: ExtractedStudent
    ) => {

      if (
        !student.studentName &&
        !student.registerNumber &&
        !student.dateOfBirth
      ) {
        throw new Error(
          "Certificate could not be read."
        );
      }

      const studentData: Record<
        string,
        any
      > = {};

      if (student.studentName) {
        studentData.student_name =
          student.studentName;
      }

      if (student.registerNumber) {
        studentData.register_number =
          student.registerNumber;
      }

      if (student.dateOfBirth) {
        studentData.date_of_birth =
          convertDateToISO(
            student.dateOfBirth
          );
      }

      /*
      ==================================================
      EDUTRIO STUDENT ID

      Example:
      ET-2313317580
      ==================================================
      */

      if (
        student.registerNumber
      ) {
        studentData.edutrio_student_id =
          `ET-${student.registerNumber}`;
      }

      // -----------------------------------------------
      // CHECK EXISTING STUDENT
      // -----------------------------------------------

      let existingId: string | null =
        null;

      if (
        student.registerNumber
      ) {
        const {
          data,
          error,
        } = await supabase
          .from(
            "01_student_information"
          )
          .select("id")
          .eq(
            "register_number",
            student.registerNumber
          )
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (data?.id) {
          existingId =
            data.id;
        }
      }

      // -----------------------------------------------
      // UPDATE EXISTING
      // -----------------------------------------------

      if (existingId) {

        const {
          error,
        } = await supabase
          .from(
            "01_student_information"
          )
          .update(
            studentData
          )
          .eq(
            "id",
            existingId
          );

        if (error) {
          throw error;
        }

        return;
      }

      // -----------------------------------------------
      // INSERT NEW
      // -----------------------------------------------

      const {
        error,
      } = await supabase
        .from(
          "01_student_information"
        )
        .insert(
          studentData
        );

      if (error) {
        throw error;
      }
    };

  // =====================================================
  // START OCR
  // =====================================================

  const startScan =
    async () => {

      if (!file) {
        alert(
          "Please upload or capture a certificate first."
        );

        return;
      }

      try {

        setOcrLoading(true);
        setSuccess(false);
        setStatus(
          "Reading certificate..."
        );

        // ---------------------------------------------
        // OCR
        // ---------------------------------------------

        const extracted =
          await extractStudentDetails(
            file
          );

        console.log(
          "FINAL EXTRACTED DATA:",
          extracted
        );

        // ---------------------------------------------
        // SAVE DIRECTLY
        // ---------------------------------------------

        setStatus(
          "Saving student data..."
        );

        await saveStudent(
          extracted
        );

        // ---------------------------------------------
        // SUCCESS
        // ---------------------------------------------

        setSuccess(true);

        setStatus(
          "Student data saved successfully."
        );

      } catch (error: any) {

        console.error(
          "OCR / SAVE ERROR:",
          error
        );

        setSuccess(false);

        setStatus(
          "Unable to process this certificate. Please capture a clear image."
        );

      } finally {

        setOcrLoading(false);
      }
    };

  // =====================================================
  // CLEANUP
  // =====================================================

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // =====================================================
  // UI
  // =====================================================

  return (
    <div className="app">

      <div className="card">

        <div className="logo">
          🎓
        </div>

        <h1>
          Edu Trio ERP
        </h1>

        <p className="subtitle">
          Smart Student Document Auto-Fill System
        </p>

        <div className="line"></div>

        {/* =================================================
            CAMERA
        ================================================= */}

        {cameraOpen ? (

          <div className="camera-screen">

            <div className="camera-header">

              <h2>
                📷 Scan Certificate
              </h2>

              <p>
                Position the complete certificate
                inside the frame
              </p>

            </div>

            <div className="camera-frame">

              {!cameraError ? (

                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                />

              ) : (

                <div className="camera-error">

                  <div className="camera-error-icon">
                    📷
                  </div>

                  <h3>
                    Camera Not Available
                  </h3>

                  <p>
                    {cameraError}
                  </p>

                  <button
                    className="retry-camera"
                    onClick={openCamera}
                  >
                    🔄 Try Again
                  </button>

                </div>

              )}

              {!cameraError && (

                <div className="scanner-frame">

                  <div className="corner top-left"></div>
                  <div className="corner top-right"></div>
                  <div className="corner bottom-left"></div>
                  <div className="corner bottom-right"></div>

                </div>

              )}

            </div>

            <div className="camera-buttons">

              <button
                className="cancel-camera"
                onClick={closeCamera}
              >
                ✕ Cancel
              </button>

              <button
                className="capture-button"
                onClick={capturePhoto}
                disabled={
                  !!cameraError
                }
              >
                📸 Capture
              </button>

            </div>

          </div>

        ) : !file ? (

          /* =================================================
             UPLOAD SCREEN
          ================================================= */

          <>

            <h2>
              📄 Scan Student Certificate
            </h2>

            <p className="description">
              Upload or scan the certificate.
              Student information will be automatically
              extracted and saved to Supabase.
            </p>

            <div className="scanner-options">

              <button
                className="scanner-option"
                onClick={() =>
                  fileInputRef.current?.click()
                }
              >

                <div className="scanner-icon">
                  📤
                </div>

                <h3>
                  Upload Certificate
                </h3>

                <p>
                  Select certificate image
                </p>

                <span>
                  JPG • PNG
                </span>

              </button>

              <button
                className="scanner-option camera-option"
                onClick={openCamera}
              >

                <div className="scanner-icon">
                  📷
                </div>

                <h3>
                  Scan with Camera
                </h3>

                <p>
                  Capture certificate
                </p>

                <span>
                  Open Camera
                </span>

              </button>

            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden-input"
              onChange={(event) =>
                handleFile(
                  event.target.files?.[0]
                )
              }
            />

            <div className="info">

              <span>
                💡
              </span>

              <div>

                <strong>
                  Automatic Data Entry
                </strong>

                <p>
                  No manual typing required.
                  OCR reads the certificate and
                  automatically saves student data.
                </p>

              </div>

            </div>

          </>

        ) : (

          /* =================================================
             PREVIEW
          ================================================= */

          <div className="preview-container">

            <div className="preview-top">

              <div>

                <h2>
                  🖼️ Certificate Preview
                </h2>

                <p>
                  {file.name}
                </p>

              </div>

              <button
                className="remove-btn"
                onClick={removeFile}
              >
                🗑 Remove
              </button>

            </div>

            {preview ? (

              <img
                src={preview}
                alt="Certificate"
                className="certificate-image"
              />

            ) : (

              <div className="pdf-preview">
                📄
              </div>

            )}

            {/* =================================================
                RETAKE
            ================================================= */}

            {capturedPreview && (

              <button
                className="cancel-camera"
                onClick={retakePhoto}
                style={{
                  width: "100%",
                  marginTop: "20px",
                }}
              >
                🔄 Retake Photo
              </button>

            )}

            {/* =================================================
                OCR BUTTON
            ================================================= */}

            {!success && (

              <button
                className="scan-btn"
                onClick={startScan}
                disabled={ocrLoading}
              >

                {ocrLoading
                  ? "🔍 Reading & Saving..."
                  : "🤖 Scan Certificate"}

              </button>

            )}

            {/* =================================================
                PROCESSING
            ================================================= */}

            {ocrLoading && (

              <div className="ocr-loading">

                <h3>
                  🔍 Processing Certificate...
                </h3>

                <p>
                  Reading student information
                  and saving automatically.
                </p>

              </div>

            )}

            {/* =================================================
                SUCCESS
            ================================================= */}

            {success && (

              <div className="success-message">

                <div
                  style={{
                    fontSize: "48px",
                    marginBottom: "10px",
                  }}
                >
                  ✅
                </div>

                <h2>
                  Successfully Saved
                </h2>

                <p>
                  Student information has been
                  automatically saved to Supabase.
                </p>

              </div>

            )}

            {/* =================================================
                STATUS
            ================================================= */}

            {!success &&
              status &&
              !ocrLoading && (

                <div className="error-message">

                  <p>
                    {status}
                  </p>

                </div>

              )}

          </div>

        )}

      </div>

    </div>
  );
}

export default App;