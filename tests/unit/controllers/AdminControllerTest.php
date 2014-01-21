<?php namespace Wardrobe\Cabinet\Controllers;

use Illuminate\Support\Facades\View;
use Wardrobe\Cabinet\TestCase;

class AdminControllerTest extends TestCase {

	public function setUp()
	{
		parent::setUp();
	}

	public function testIndex()
	{
		View::shouldReceive('make')->once()->with('cabinet::admin.index')->andReturn('admin index!');

		$response = $this->action('GET', self::$wardrobeControllers . 'AdminController@index');

        $this->assertSame('admin index!', $response->original);
	}
}
 