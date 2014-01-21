<?php namespace Wardrobe\Cabinet\Controllers;

use Illuminate\Support\Facades\Redirect;
use Illuminate\Support\Facades\View;
use Illuminate\Support\Facades\Input;
use Mockery;
use Wardrobe\Cabinet\TestCase;

class LoginControllerTest extends TestCase {

	private $userRepositoryInterface;

	public function setUp()
	{
		parent::setUp();

		$this->userRepositoryInterface = Mockery::mock('Wardrobe\Cabinet\Repositories\UserRepositoryInterface');
		$this->app->instance('Wardrobe\Cabinet\Repositories\UserRepositoryInterface', $this->userRepositoryInterface);
	}

	public function testCreate()
	{
		View::shouldReceive('make')->once()->with('cabinet::admin.login')->andReturn('admin login');

		$response = $this->action('GET', self::$wardrobeControllers . 'LoginController@create');

		$this->assertSame('admin login', $response->original);
	}

	public function testStore()
	{
		$input = ['email' => 'me@example.com', 'password' => 'wardrobe', 'remember' => true];

		$this->userRepositoryInterface
			->shouldReceive('login')->once()->with($input['email'], $input['password'], $input['remember'])->andReturn(true);

		Redirect::shouldReceive('intended')->once()->with('wardrobe.admin.index')->andReturn('wardrobe.admin.index');

		$this->app->instance('Wardrobe\Cabinet\Repositories\UserRepositoryInterface', $this->userRepositoryInterface);

		$response = $this->action('POST', self::$wardrobeControllers . 'LoginController@store', [], $input);

		$this->assertSame('wardrobe.admin.index', $response->original);
	}

}
 