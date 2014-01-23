<?php namespace Wardrobe\Cabinet\Repositories;

use Mockery;
use Wardrobe\Cabinet\Repositories\DbUserRepository;
use Wardrobe\Cabinet\TestCase;

class DbUserRepositoryTest extends TestCase {

	private $user;

	public function setUp()
	{
		parent::setUp();

		$this->user = Mockery::mock('Wardrobe\Core\Entities\User');
	}

	public function tearDown()
	{
		parent::tearDown();
	}

	private function DbUserRepository()
	{
		return new DbUserRepository($this->user);
	}
}
