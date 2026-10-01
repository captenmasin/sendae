<?php

namespace Tests\Feature;

use Mockery;
use Tests\TestCase;
use Native\Desktop\Facades\Window;
use PHPUnit\Framework\Attributes\Test;
use App\Providers\NativeAppServiceProvider;

class NativeWindowTest extends TestCase
{
    #[Test]
    public function desktop_window_hides_the_title_bar_and_keeps_native_controls(): void
    {
        $window = Mockery::mock();
        $window->shouldReceive('title', 'titleBarHiddenInset', 'width', 'height', 'minWidth', 'minHeight')->andReturnSelf();
        Window::shouldReceive('open')->once()->andReturn($window);

        (new NativeAppServiceProvider)->boot();

        $window->shouldHaveReceived('titleBarHiddenInset')->once();
    }
}
