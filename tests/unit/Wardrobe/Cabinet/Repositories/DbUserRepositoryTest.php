<?php namespace Wardrobe\Cabinet\Repositories;

use Auth;
use Hash;
use Mockery;
use Validator;
use Wardrobe\Cabinet\Repositories\DbUserRepository;
use Wardrobe\Cabinet\TestCase;

class DbUserRepositoryTest extends TestCase {

	private $user;

	public function setUp()
	{
		parent::setUp();

		$this->user = Mockery::mock('Wardrobe\Core\Entities\User');
	}

	private function DbUserRepository()
	{
		return new DbUserRepository($this->user);
	}

	private function person()
	{
		return (object) [
			'first_name' => 'Cabinet',
			'last_name' => 'Wardrobe',
			'email' => 'cabinet@wardrobecms.com',
			'active' => true,
			'password' => 'laravel'
		];
	}

	public function testAll()
	{
		$this->user->shouldReceive('all')->once()->withNoArgs()->andReturn(['eric', 'metalmatze']);

		$returned = $this->DbUserRepository()->all();

		$this->assertSame(['eric', 'metalmatze'], $returned);
	}

	public function testFind()
	{
		$this->user->shouldReceive('findOrFail')->once()->with(42)->andReturn('Post about wardrobe');

		$returned = $this->DbUserRepository()->find(42);

		$this->assertSame('Post about wardrobe', $returned);
	}

	public function testCreate()
	{
		$person = $this->person();

		Hash::shouldReceive('make')->once()->with($person->password)->andReturn($person->password);
		$this->user->shouldReceive('create')->once()->with((array)$person)->andReturn('user cabinet created');

		$returned = $this->DbUserRepository()->create($person->first_name, $person->last_name, $person->email, $person->active, $person->password);

		$this->assertSame('user cabinet created', $returned);
	}

	public function testLogin()
	{
		$person = $this->person();
		Auth::shouldReceive('attempt')->once()->with(['email'=>'cabinet@wardrobecms.com','password'=>'laravel'], false)->andReturn(true);


		$returned = $this->DbUserRepository()->login($person->email, $person->password);

		$this->assertTrue($returned);
	}

	public function testLoginFails()
	{
		$person = $this->person();
		Auth::shouldReceive('attempt')->once()->andReturn(false);

		$returned = $this->DbUserRepository()->login($person->email, 'zend');

		$this->assertFalse($returned);
	}

	public function testDelete()
	{
		$this->user->shouldReceive('where')->once()->with('id', 42)->andReturn($this->user)
				->shouldReceive('delete')->once()->withNoArgs()->andReturn(true);

		$returned = $this->DbUserRepository()->delete(42);

		$this->assertTrue($returned);
	}
}
