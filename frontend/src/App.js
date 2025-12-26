import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist/webpack';
import { Download, Square, Type, Image as ImageIcon, Calendar, Circle, Save, Upload, FileText, Trash2 } from 'lucide-react';
import './App.css';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

const API_URL = process.env.REACT_APP_API_URL || 'https://pdf-repo.onrender.com';

const FIELD_TYPES = [
  { id: 'signature', label: 'Signature', icon: Square, color: 'bg-blue-500' },
  { id: 'text', label: 'Text Box', icon: Type, color: 'bg-green-500' },
  { id: 'image', label: 'Image', icon: ImageIcon, color: 'bg-purple-500' },
  { id: 'date', label: 'Date', icon: Calendar, color: 'bg-orange-500' },
  { id: 'radio', label: 'Radio', icon: Circle, color: 'bg-pink-500' }
];

function App() {
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfId, setPdfId] = useState(null);
  const [pdfDimensions, setPdfDimensions] = useState({ width: 595, height: 842 });
  const [fields, setFields] = useState([]);
  const [selectedField, setSelectedField] = useState(null);
  const [dragType, setDragType] = useState(null);
  const [viewportScale, setViewportScale] = useState(1);
  const [signatureData, setSignatureData] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [pdfCanvas, setPdfCanvas] = useState(null);

  const pdfContainerRef = useRef(null);
  const canvasRef = useRef(null);
  const pdfFileInputRef = useRef(null);
  const signatureFileInputRef = useRef(null);

  // Render PDF on canvas
  const renderPDF = async (file) => {
    const fileReader = new FileReader();
    fileReader.onload = async function() {
      const typedArray = new Uint8Array(this.result);
      const loadingTask = pdfjsLib.getDocument(typedArray);
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);

      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      // Store actual PDF dimensions (in points at 72 DPI)
      const pdfWidth = page.view[2] - page.view[0];
      const pdfHeight = page.view[3] - page.view[1];
      setPdfDimensions({ width: pdfWidth, height: pdfHeight });

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      await page.render(renderContext).promise;
      setPdfCanvas(canvas);
    };
    fileReader.readAsArrayBuffer(file);
  };

  // Handle PDF file upload
  const handlePDFUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setPdfFile(file);
    setIsUploading(true);
    
    await renderPDF(file);

    // Upload to backend
    const formData = new FormData();
    formData.append('pdf', file);

    try {
      const response = await fetch(`${API_URL}/api/upload-pdf`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      if (data.success) {
        setPdfId(data.pdfId);
        console.log('PDF uploaded:', data);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload PDF');
    }

    setIsUploading(false);
  };

  // Calculate viewport scale
  useEffect(() => {
    const updateScale = () => {
      if (pdfContainerRef.current && pdfCanvas) {
        const containerWidth = pdfContainerRef.current.offsetWidth;
        const scale = containerWidth / pdfCanvas.width;
        setViewportScale(scale);
      }
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [pdfCanvas]);

  // Convert screen coordinates to PDF coordinates
  const screenToPDF = (screenX, screenY, width, height) => {
    if (!pdfCanvas) return { x: 0, y: 0, width: 0, height: 0 };

    const scaleX = pdfDimensions.width / pdfCanvas.width;
    const scaleY = pdfDimensions.height / pdfCanvas.height;

    const pdfX = screenX / viewportScale * scaleX;
    const pdfWidth = width / viewportScale * scaleX;
    const pdfHeight = height / viewportScale * scaleY;
    
    // PDF uses bottom-left origin
    const pdfY = pdfDimensions.height - (screenY / viewportScale * scaleY) - pdfHeight;

    return {
      x: Math.round(pdfX * 100) / 100,
      y: Math.round(pdfY * 100) / 100,
      width: Math.round(pdfWidth * 100) / 100,
      height: Math.round(pdfHeight * 100) / 100
    };
  };

  // Convert PDF coordinates to screen coordinates
  const pdfToScreen = (pdfX, pdfY, pdfWidth, pdfHeight) => {
    if (!pdfCanvas) return { screenX: 0, screenY: 0, width: 0, height: 0 };

    const scaleX = pdfCanvas.width / pdfDimensions.width;
    const scaleY = pdfCanvas.height / pdfDimensions.height;

    const screenX = pdfX * scaleX * viewportScale;
    const screenY = (pdfDimensions.height - pdfY - pdfHeight) * scaleY * viewportScale;
    const width = pdfWidth * scaleX * viewportScale;
    const height = pdfHeight * scaleY * viewportScale;

    return { screenX, screenY, width, height };
  };

  // Handle drag and drop
  const handleDragStart = (e, type) => {
    e.dataTransfer.effectAllowed = 'copy';
    setDragType(type);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (!dragType || !pdfCanvas) return;

    const rect = pdfContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const defaultWidth = 150;
    const defaultHeight = 50;

    const pdfCoords = screenToPDF(x, y, defaultWidth, defaultHeight);

    const newField = {
      id: `field-${Date.now()}`,
      type: dragType,
      screenX: x,
      screenY: y,
      width: defaultWidth,
      height: defaultHeight,
      pdfCoords: pdfCoords,
      value: ''
    };

    setFields([...fields, newField]);
    setDragType(null);
  };

  // Handle field movement
  const handleFieldMouseDown = (e, fieldId) => {
    e.stopPropagation();
    if (e.target.classList.contains('resize-handle')) return;

    setSelectedField(fieldId);
    const field = fields.find(f => f.id === fieldId);
    const rect = pdfContainerRef.current.getBoundingClientRect();
    
    const offsetX = e.clientX - rect.left - field.screenX;
    const offsetY = e.clientY - rect.top - field.screenY;

    const handleMove = (moveEvent) => {
      const newX = moveEvent.clientX - rect.left - offsetX;
      const newY = moveEvent.clientY - rect.top - offsetY;

      setFields(prev => prev.map(f => {
        if (f.id === fieldId) {
          const pdfCoords = screenToPDF(newX, newY, f.width, f.height);
          return { ...f, screenX: newX, screenY: newY, pdfCoords };
        }
        return f;
      }));
    };

    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  // Handle field resize
  const handleResizeMouseDown = (e, fieldId) => {
    e.stopPropagation();
    setSelectedField(fieldId);

    const field = fields.find(f => f.id === fieldId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = field.width;
    const startHeight = field.height;

    const handleMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      const newWidth = Math.max(50, startWidth + deltaX);
      const newHeight = Math.max(30, startHeight + deltaY);

      setFields(prev => prev.map(f => {
        if (f.id === fieldId) {
          const pdfCoords = screenToPDF(f.screenX, f.screenY, newWidth, newHeight);
          return { ...f, width: newWidth, height: newHeight, pdfCoords };
        }
        return f;
      }));
    };

    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  // Handle signature upload
  const handleSignatureUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setSignatureData(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle document signing
  const handleSignDocument = async () => {
    if (!signatureData) {
      alert('Please upload a signature image first');
      return;
    }

    const signatureField = fields.find(f => f.type === 'signature');
    if (!signatureField) {
      alert('Please place a signature field on the document');
      return;
    }

    if (!pdfId) {
      alert('Please upload a PDF first');
      return;
    }

    setIsSigning(true);

    const payload = {
      pdfId: pdfId,
      signatureImage: signatureData,
      coordinates: signatureField.pdfCoords
    };

    try {
      const response = await fetch(`${API_URL}/api/sign-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      
      if (data.success) {
        alert('Document signed successfully!');
        console.log('Audit Trail:', data.auditTrail);
        window.open(data.downloadUrl, '_blank');
      } else {
        alert('Failed to sign document');
      }
    } catch (error) {
      console.error('Signing error:', error);
      alert('Failed to sign document');
    }

    setIsSigning(false);
  };

  // Delete field
  const handleDeleteField = (fieldId) => {
    setFields(fields.filter(f => f.id !== fieldId));
    if (selectedField === fieldId) {
      setSelectedField(null);
    }
  };

  // Update field positions on scale change
  useEffect(() => {
    if (!pdfCanvas) return;
    
    setFields(prev => prev.map(field => {
      const { screenX, screenY, width, height } = pdfToScreen(
        field.pdfCoords.x,
        field.pdfCoords.y,
        field.pdfCoords.width,
        field.pdfCoords.height
      );
      return { ...field, screenX, screenY, width, height };
    }));
  }, [viewportScale, pdfCanvas]);

  return (
    <div className="app-container">
      <div className="header">
        <div className="header-content">
          <div className="logo">
            <FileText size={32} />
            <h1>PDF Signature Engine</h1>
          </div>
          <div className="actions">
            <input
              type="file"
              ref={pdfFileInputRef}
              onChange={handlePDFUpload}
              accept="application/pdf"
              style={{ display: 'none' }}
            />
            <button 
              onClick={() => pdfFileInputRef.current?.click()}
              className="btn btn-primary"
              disabled={isUploading}
            >
              <Upload size={18} />
              {isUploading ? 'Uploading...' : 'Upload PDF'}
            </button>

            <input
              type="file"
              ref={signatureFileInputRef}
              onChange={handleSignatureUpload}
              accept="image/*"
              style={{ display: 'none' }}
            />
            <button
              onClick={() => signatureFileInputRef.current?.click()}
              className="btn btn-success"
              disabled={!pdfFile}
            >
              <ImageIcon size={18} />
              Upload Signature
            </button>

            <button
              onClick={handleSignDocument}
              disabled={isSigning || !signatureData || !pdfFile}
              className="btn btn-accent"
            >
              <Save size={18} />
              {isSigning ? 'Signing...' : 'Sign Document'}
            </button>
          </div>
        </div>
      </div>

      <div className="main-content">
        <div className="sidebar">
          <h3>Field Types</h3>
          <div className="field-types">
            {FIELD_TYPES.map(field => (
              <div
                key={field.id}
                draggable
                onDragStart={(e) => handleDragStart(e, field.id)}
                className={`field-type ${field.id}`}
              >
                <field.icon size={20} />
                <span>{field.label}</span>
              </div>
            ))}
          </div>

          {signatureData && (
            <div className="signature-preview">
              <h4>Signature Preview</h4>
              <img src={signatureData} alt="Signature" />
            </div>
          )}

          <div className="info-box">
            <p><strong>Scale:</strong> {(viewportScale * 100).toFixed(0)}%</p>
            <p className="hint">Resize browser to test responsiveness</p>
          </div>
        </div>

        <div className="pdf-viewer-container">
          {!pdfFile ? (
            <div className="empty-state">
              <FileText size={64} />
              <h2>No PDF Loaded</h2>
              <p>Upload a PDF document to get started</p>
              <button 
                onClick={() => pdfFileInputRef.current?.click()}
                className="btn btn-primary"
              >
                <Upload size={18} />
                Upload PDF
              </button>
            </div>
          ) : (
            <div
              ref={pdfContainerRef}
              className="pdf-canvas-wrapper"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <canvas ref={canvasRef} style={{ width: '100%', height: 'auto' }} />
              
              {fields.map(field => {
                const fieldType = FIELD_TYPES.find(t => t.id === field.type);
                return (
                  <div
                    key={field.id}
                    onMouseDown={(e) => handleFieldMouseDown(e, field.id)}
                    className={`field-box ${selectedField === field.id ? 'selected' : ''}`}
                    style={{
                      left: `${field.screenX}px`,
                      top: `${field.screenY}px`,
                      width: `${field.width}px`,
                      height: `${field.height}px`
                    }}
                  >
                    <div className="field-content">
                      <fieldType.icon size={16} />
                      <span>{fieldType.label}</span>
                    </div>
                    <button 
                      className="delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteField(field.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                    <div
                      className="resize-handle"
                      onMouseDown={(e) => handleResizeMouseDown(e, field.id)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selectedField && (
        <div className="coordinates-display">
          <h3>Coordinate Information</h3>
          <div className="coord-grid">
            <div className="coord-section">
              <h4>Screen Coordinates (Top-Left)</h4>
              <pre>
                {JSON.stringify(
                  {
                    x: Math.round(fields.find(f => f.id === selectedField)?.screenX),
                    y: Math.round(fields.find(f => f.id === selectedField)?.screenY),
                    width: Math.round(fields.find(f => f.id === selectedField)?.width),
                    height: Math.round(fields.find(f => f.id === selectedField)?.height)
                  },
                  null,
                  2
                )}
              </pre>
            </div>
            <div className="coord-section">
              <h4>PDF Coordinates (Bottom-Left, 72 DPI)</h4>
              <pre>
                {JSON.stringify(fields.find(f => f.id === selectedField)?.pdfCoords, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
