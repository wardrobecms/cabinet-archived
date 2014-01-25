<?php namespace Wardrobe\Cabinet\Repositories;

use Mockery;
use Wardrobe\Cabinet\Repositories\DbUserRepository;
use Wardrobe\Cabinet\TestCase;
use Hash;

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
		$this->user->shouldReceive('create')->once()->with((array)$person);

		$this->DbUserRepository()->create($person->first_name, $person->last_name, $person->email, $person->active, $person->password);

	}
}
