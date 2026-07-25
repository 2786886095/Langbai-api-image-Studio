#pragma once

#include <flutter/texture_registrar.h>

#include "texture_bridge.h"

class TextureBridgeGpu : public TextureBridge {
 public:
  TextureBridgeGpu(GraphicsContext* graphics_context,
                   ABI::Windows::UI::Composition::IVisual* visual);

  const FlutterDesktopGpuSurfaceDescriptor* GetSurfaceDescriptor(size_t width,
                                                                 size_t height);

  // Reads the alpha value of a single pixel at (x, y) from the last captured
  // frame. Returns 255 (opaque) if no frame is available or coordinates are
  // out of bounds.
  uint8_t ReadAlpha(int x, int y);

  void SetOutputScale(float scale) { output_scale_ = scale; }

 protected:
  void StopInternal() override;

 private:
  FlutterDesktopGpuSurfaceDescriptor surface_descriptor_ = {};
  Size surface_size_ = {0, 0};
  float output_scale_ = 1.0f;
  winrt::com_ptr<ID3D11Texture2D> surface_{nullptr};
  winrt::com_ptr<IDXGIResource> dxgi_surface_;
  winrt::com_ptr<ID3D11Texture2D> staging_texture_{nullptr};

  void ProcessFrame(winrt::com_ptr<ID3D11Texture2D> src_texture,
                    size_t requested_width, size_t requested_height);
  void EnsureSurface(uint32_t width, uint32_t height);
  void EnsureStagingTexture();
};
