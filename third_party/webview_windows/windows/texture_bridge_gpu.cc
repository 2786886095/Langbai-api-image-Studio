#include "texture_bridge_gpu.h"

#include <iostream>

#include "util/direct3d11.interop.h"

TextureBridgeGpu::TextureBridgeGpu(
    GraphicsContext* graphics_context,
    ABI::Windows::UI::Composition::IVisual* visual)
    : TextureBridge(graphics_context, visual) {
  surface_descriptor_.struct_size = sizeof(FlutterDesktopGpuSurfaceDescriptor);
  surface_descriptor_.format =
      kFlutterDesktopPixelFormatNone;  // no format required for DXGI surfaces
}

void TextureBridgeGpu::ProcessFrame(winrt::com_ptr<ID3D11Texture2D> src_texture,
                                    size_t requested_width,
                                    size_t requested_height) {
  D3D11_TEXTURE2D_DESC desc;
  src_texture->GetDesc(&desc);

  // Flutter asks for the texture using the TextureLayer's logical rect size,
  // however the webview renders at physical resolution, so we upscale the
  // requested size to match the captured content.
  const float out_scale = output_scale_ > 0 ? output_scale_ : 1.0f;
  const size_t surface_width = static_cast<size_t>(
      static_cast<float>(requested_width) * out_scale + 0.5f);
  const size_t surface_height = static_cast<size_t>(
      static_cast<float>(requested_height) * out_scale + 0.5f);

  auto effective_width =
      (std::min)(last_content_size_.width, static_cast<size_t>(desc.Width));
  auto effective_height =
      (std::min)(last_content_size_.height, static_cast<size_t>(desc.Height));

  EnsureSurface(static_cast<uint32_t>(surface_width),
                static_cast<uint32_t>(surface_height));

  auto device_context = graphics_context_->d3d_device_context();

  // If the captured content and dest surface are exactly the same size as
  // the src texture, a straight CopyResource is the cheapest path.
  if (effective_width == surface_width && effective_height == surface_height &&
      desc.Width == surface_width && desc.Height == surface_height) {
    device_context->CopyResource(surface_.get(), src_texture.get());
  } else {
    D3D11_BOX src_box = {};
    src_box.right =
        static_cast<UINT>((std::min)(effective_width, surface_width));
    src_box.bottom =
        static_cast<UINT>((std::min)(effective_height, surface_height));
    src_box.back = 1;

    if (src_box.right > 0 && src_box.bottom > 0) {
      // Copy a top-left sub-region of the captured texture into the output
      // surface. The surface is sized to match the physical capture, so this
      // is a straight memcpy of rendered pixels.
      device_context->CopySubresourceRegion(surface_.get(), 0, 0, 0, 0,
                                            src_texture.get(), 0, &src_box);
    }
  }

  device_context->Flush();
}

void TextureBridgeGpu::EnsureSurface(uint32_t width, uint32_t height) {
  if (!surface_ || surface_size_.width != width ||
      surface_size_.height != height) {
    D3D11_TEXTURE2D_DESC dstDesc = {};
    dstDesc.ArraySize = 1;
    dstDesc.MipLevels = 1;
    dstDesc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    dstDesc.CPUAccessFlags = 0;
    dstDesc.Format = static_cast<DXGI_FORMAT>(kPixelFormat);
    dstDesc.Width = width;
    dstDesc.Height = height;
    dstDesc.MiscFlags = D3D11_RESOURCE_MISC_SHARED;
    dstDesc.SampleDesc.Count = 1;
    dstDesc.SampleDesc.Quality = 0;
    dstDesc.Usage = D3D11_USAGE_DEFAULT;

    surface_ = nullptr;
    if (!SUCCEEDED(graphics_context_->d3d_device()->CreateTexture2D(
            &dstDesc, nullptr, surface_.put()))) {
      std::cerr << "Creating intermediate texture failed" << std::endl;
      return;
    }

    HANDLE shared_handle;
    surface_.try_as(dxgi_surface_);
    assert(dxgi_surface_);
    dxgi_surface_->GetSharedHandle(&shared_handle);

    surface_descriptor_.handle = shared_handle;
    surface_descriptor_.width = surface_descriptor_.visible_width = width;
    surface_descriptor_.height = surface_descriptor_.visible_height = height;
    surface_descriptor_.release_context = surface_.get();
    surface_descriptor_.release_callback = [](void* release_context) {
      auto texture = reinterpret_cast<ID3D11Texture2D*>(release_context);
      texture->Release();
    };

    surface_size_ = {width, height};
  }
}

const FlutterDesktopGpuSurfaceDescriptor*
TextureBridgeGpu::GetSurfaceDescriptor(size_t width, size_t height) {
  const std::lock_guard<std::mutex> lock(mutex_);

  if (!is_running_) {
    return nullptr;
  }

  if (last_frame_) {
    ProcessFrame(last_frame_, width, height);
  }

  if (surface_) {
    // Gets released in the SurfaceDescriptor's release callback.
    surface_->AddRef();
  }

  return &surface_descriptor_;
}

void TextureBridgeGpu::EnsureStagingTexture() {
  if (staging_texture_) {
    return;
  }

  D3D11_TEXTURE2D_DESC desc = {};
  desc.ArraySize = 1;
  desc.MipLevels = 1;
  desc.BindFlags = 0;
  desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  desc.Format = static_cast<DXGI_FORMAT>(kPixelFormat);
  desc.Width = 1;
  desc.Height = 1;
  desc.SampleDesc.Count = 1;
  desc.SampleDesc.Quality = 0;
  desc.Usage = D3D11_USAGE_STAGING;

  if (!SUCCEEDED(graphics_context_->d3d_device()->CreateTexture2D(
          &desc, nullptr, staging_texture_.put()))) {
    std::cerr << "Creating staging texture for hit testing failed" << std::endl;
  }
}

uint8_t TextureBridgeGpu::ReadAlpha(int x, int y) {
  const std::lock_guard<std::mutex> lock(mutex_);

  if (!last_frame_ || x < 0 || y < 0) {
    return 255;
  }

  D3D11_TEXTURE2D_DESC frame_desc;
  last_frame_->GetDesc(&frame_desc);

  if (static_cast<UINT>(x) >= frame_desc.Width ||
      static_cast<UINT>(y) >= frame_desc.Height) {
    return 255;
  }

  EnsureStagingTexture();
  if (!staging_texture_) {
    return 255;
  }

  auto device_context = graphics_context_->d3d_device_context();

  D3D11_BOX src_box = {};
  src_box.left = static_cast<UINT>(x);
  src_box.top = static_cast<UINT>(y);
  src_box.right = src_box.left + 1;
  src_box.bottom = src_box.top + 1;
  src_box.front = 0;
  src_box.back = 1;

  device_context->CopySubresourceRegion(staging_texture_.get(), 0, 0, 0, 0,
                                        last_frame_.get(), 0, &src_box);

  D3D11_MAPPED_SUBRESOURCE mapped = {};
  if (FAILED(device_context->Map(staging_texture_.get(), 0, D3D11_MAP_READ, 0,
                                 &mapped))) {
    return 255;
  }

  // BGRA format: B=0, G=1, R=2, A=3
  uint8_t alpha = static_cast<uint8_t*>(mapped.pData)[3];

  device_context->Unmap(staging_texture_.get(), 0);

  return alpha;
}

void TextureBridgeGpu::StopInternal() {
  TextureBridge::StopInternal();

  // For some reason, the destination surface needs to be recreated upon
  // resuming. Force |EnsureSurface| to create a new one by resetting it here.
  surface_ = nullptr;
}
