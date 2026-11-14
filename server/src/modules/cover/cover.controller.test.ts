import { BadRequestException } from '@nestjs/common';
import { COVER_SEARCH_FAILED_SOURCES_HEADER } from '@bookorbit/types';

import { CoverController } from './cover.controller';

describe('CoverController', () => {
  const coverService = {
    searchCovers: vi.fn(),
    listCoverSources: vi.fn(),
    proxyImage: vi.fn(),
    uploadCover: vi.fn(),
    uploadCoverFromUrl: vi.fn(),
    deleteCover: vi.fn(),
  };

  const controller = new CoverController(coverService as never);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes search filters to cover service', async () => {
    const response = { header: vi.fn() };
    coverService.searchCovers.mockResolvedValue({ results: [], failedSources: ['hachette-uk'] });
    await expect(
      controller.searchCovers(
        {
          title: 'Dune',
          author: 'Frank Herbert',
          isAudiobook: true,
          provider: 'all',
        },
        response as never,
        { id: 7 } as never,
      ),
    ).resolves.toEqual([]);

    expect(coverService.searchCovers).toHaveBeenCalledWith(
      {
        title: 'Dune',
        author: 'Frank Herbert',
        isAudiobook: true,
        provider: 'all',
      },
      7,
    );
    expect(response.header).toHaveBeenCalledWith(COVER_SEARCH_FAILED_SOURCES_HEADER, 'hachette-uk');
  });

  it('lists available cover sources', async () => {
    coverService.listCoverSources.mockResolvedValue([{ key: 'metadata:hardcover', label: 'Hardcover', media: ['ebook', 'audio'] }]);
    await expect(controller.listCoverSources({ id: 12 } as never)).resolves.toEqual([
      { key: 'metadata:hardcover', label: 'Hardcover', media: ['ebook', 'audio'] },
    ]);
    expect(coverService.listCoverSources).toHaveBeenCalledWith(12);
  });

  it('writes proxied image content to the response object', async () => {
    const buffer = Buffer.from('img');
    const reply = {
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    coverService.proxyImage.mockResolvedValue({ buffer, contentType: 'image/jpeg' });

    await controller.proxyImage({ url: 'https://covers.example.com/dune.jpg' }, reply as never);

    expect(coverService.proxyImage).toHaveBeenCalledWith('https://covers.example.com/dune.jpg');
    expect(reply.type).toHaveBeenCalledWith('image/jpeg');
    expect(reply.send).toHaveBeenCalledWith(buffer);
  });

  it('rejects uploads with missing multipart file', async () => {
    const req = { file: vi.fn().mockResolvedValue(null) };

    await expect(controller.uploadCover(1, { id: 7 } as never, req as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.uploadCover(1, { id: 7 } as never, req as never)).rejects.toThrow('No file provided');
  });

  it('uploads multipart image bytes through cover service', async () => {
    const buffer = Buffer.from('bytes');
    const req = {
      file: vi.fn().mockResolvedValue({
        mimetype: 'image/png',
        toBuffer: vi.fn().mockResolvedValue(buffer),
      }),
    };
    const user = { id: 7 };

    await controller.uploadCover(12, user as never, req as never);

    expect(coverService.uploadCover).toHaveBeenCalledWith(12, buffer, 'image/png', user);
  });

  it('delegates URL uploads and delete flow', async () => {
    const user = { id: 9 };
    coverService.deleteCover.mockResolvedValue('custom');

    await controller.uploadCoverFromUrl(11, { url: 'https://example.com/cover.jpg' }, user as never);
    await expect(controller.deleteCover(11, user as never)).resolves.toEqual({ coverSource: 'custom' });

    expect(coverService.uploadCoverFromUrl).toHaveBeenCalledWith(11, 'https://example.com/cover.jpg', user);
    expect(coverService.deleteCover).toHaveBeenCalledWith(11, user);
  });

  it('forwards an explicit cover medium on every write route', async () => {
    const buffer = Buffer.from('bytes');
    const req = {
      file: vi.fn().mockResolvedValue({
        mimetype: 'image/png',
        toBuffer: vi.fn().mockResolvedValue(buffer),
      }),
    };
    const user = { id: 9 };
    coverService.deleteCover.mockResolvedValue('custom');

    await controller.uploadCover(11, user as never, req as never, { medium: 'audio' });
    await controller.uploadCoverFromUrl(11, { url: 'https://example.com/cover.jpg' }, user as never, { medium: 'audio' });
    await controller.deleteCover(11, user as never, { medium: 'audio' });

    expect(coverService.uploadCover).toHaveBeenCalledWith(11, buffer, 'image/png', user, 'audio');
    expect(coverService.uploadCoverFromUrl).toHaveBeenCalledWith(11, 'https://example.com/cover.jpg', user, 'audio');
    expect(coverService.deleteCover).toHaveBeenCalledWith(11, user, 'audio');
  });
});
