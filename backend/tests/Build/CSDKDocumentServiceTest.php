<?php

declare(strict_types=1);

namespace App\Tests\Build;

use App\Build\CSDKDocumentService;
use App\Http\ApiProblem;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class CSDKDocumentServiceTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir().'/webide-sdk-'.bin2hex(random_bytes(6));
        mkdir($this->root, 0700, true);
        file_put_contents($this->root.'/acorn.h', "void acorn_oswrch(unsigned char value);\n");
    }

    protected function tearDown(): void
    {
        @unlink($this->root.'/acorn.h');
        @rmdir($this->root);
    }

    public function testReturnsBoundedImmutableSourceWithDigestAndProvenance(): void
    {
        $service = new CSDKDocumentService([['root' => $this->root, 'source' => 'test SDK', 'licence' => 'test licence']]);
        $document = $service->read('acorn.h');
        self::assertSame('8bit-net.sdk-document', $document['schema']);
        self::assertSame('acorn.h', $document['path']);
        self::assertSame('test SDK/acorn.h', $document['source']);
        self::assertTrue($document['readOnly']);
        self::assertSame(hash('sha256', (string) $document['content']), $document['sha256']);
    }

    #[DataProvider('unsafePaths')]
    public function testRejectsTraversalAbsoluteAndMalformedPaths(string $path): void
    {
        $service = new CSDKDocumentService([['root' => $this->root, 'source' => 'test SDK', 'licence' => 'test licence']]);
        try {
            $service->read($path);
            self::fail('Unsafe path was accepted');
        } catch (ApiProblem $problem) {
            self::assertSame(400, $problem->status);
            self::assertSame('SDK_PATH_INVALID', $problem->errorCode);
        }
    }

    /** @return array<string, array{string}> */
    public static function unsafePaths(): array
    {
        return ['parent' => ['../acorn.h'], 'absolute' => ['/etc/passwd'], 'empty segment' => ['sdk//acorn.h'], 'dot' => ['./acorn.h'], 'backslash' => ['sdk\\acorn.h']];
    }

    public function testReportsUnknownFilesWithoutLeakingHostPaths(): void
    {
        $service = new CSDKDocumentService([['root' => $this->root, 'source' => 'test SDK', 'licence' => 'test licence']]);
        $this->expectException(ApiProblem::class);
        $this->expectExceptionMessage('not present in the immutable');
        $service->read('missing.h');
    }
}
