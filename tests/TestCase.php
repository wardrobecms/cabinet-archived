<?php

abstract class TestCase extends PHPUnit_Framework_TestCase {

	protected function setUp()
	{

	}

	protected function tearDown() {
		Mockery::close();
	}

}
